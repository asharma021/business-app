/**
 * Research pipeline: collection → dedupe → screening → deep research → audit → scoring.
 * Every step writes structured results to the database so later steps (and
 * later runs) reuse them instead of re-researching.
 */
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import Parser from "rss-parser";
import { db } from "@/db";
import {
  financialStatements,
  listings,
  marketStats,
  opportunities,
  preferences,
  researchCitations,
  researchReports,
  sourceRecords,
  sources,
  watchlistItems,
} from "@/db/schema";
import { env, features } from "@/lib/env";
import { auditReport } from "@/lib/ai/audit";
import { looksLikeInjection } from "@/lib/ai/guard";
import { costUsd } from "@/lib/ai/provider";
import { calculate } from "@/lib/finance/calculator";
import { money } from "@/lib/format";
import { ingestCandidate, recordEvidence, type Candidate } from "@/lib/ingest";
import { addJobUsage, aiSpendLast24h, bumpJob, jobLog } from "@/lib/jobs";
import { calculatorInputsFor } from "@/lib/preferences";
import { fetchCbp, type CbpConfig } from "@/lib/sources/census";
import { FetchBlockedError, htmlToText, politeFetch } from "@/lib/sources/http";
import { discoverListings, extractListing, researchOpportunity } from "./agents";
import { bestProvenance, scoreOpportunity } from "./scoring-service";

async function sourceByKey(key: string) {
  const [s] = await db.select().from(sources).where(eq(sources.key, key));
  return s ?? null;
}
async function markSource(key: string, ok: boolean, error?: string) {
  await db
    .update(sources)
    .set({ lastRunAt: new Date(), ...(ok ? { lastSuccessAt: new Date(), lastError: null } : { lastError: error?.slice(0, 2000) ?? "error" }) })
    .where(eq(sources.key, key));
}

// ───────────────────────── Manual import ─────────────────────────

export class ImportError extends Error {}

export async function importFromText(text: string, url: string | null, jobId?: string | null) {
  if (text.trim().length < 80) throw new ImportError("Please paste more of the listing (at least a few sentences).");
  if (!features.ai()) throw new ImportError("AI extraction needs ANTHROPIC_API_KEY. Configure it to import listings.");
  const ev = await recordEvidence(url ? "manual_url" : "document", { url, text });
  const { data, usage } = await extractListing(text, url);
  await addJobUsage(jobId, usage);
  if (!data.isBusinessForSale) throw new ImportError("That content doesn't look like a specific business or franchise listing.");
  const flags = looksLikeInjection(text) ? ["Source text contained instruction-like content (possible prompt injection)"] : [];
  const res = await ingestCandidate({
    candidate: data,
    sourceKey: url ? "manual_url" : "document",
    url: url ?? `document:${ev.sourceRecordId}`,
    sourceRecordId: ev.sourceRecordId,
    provenance: "SELLER_REPORTED",
    jobId,
  });
  await scoreOpportunity(res.opportunityId);
  return { ...res, flags };
}

export async function importFromUrl(url: string, jobId?: string | null) {
  let fetched;
  try {
    fetched = await politeFetch(url);
  } catch (e) {
    if (e instanceof FetchBlockedError) {
      const why =
        e.reason === "robots"
          ? "This site's robots.txt doesn't allow automated access."
          : e.reason === "http"
            ? `The site returned an error (${e.message}). It may require a login or block automated access.`
            : e.message;
      throw new ImportError(`${why} Paste the listing text instead and include the URL — it will be stored as the source.`);
    }
    throw e;
  }
  const { title, text } = htmlToText(fetched.body);
  if (text.length < 200) throw new ImportError("The page had too little readable text (it may render with JavaScript or require a login). Paste the listing text instead.");
  return importFromText(`${title ?? ""}\n\n${text}`, fetched.url, jobId);
}

// ───────────────────────── Collectors ─────────────────────────

export async function collectMarketData(jobId: string | null) {
  const src = await sourceByKey("census_cbp");
  if (!src?.enabled || src.access !== "CONFIRMED") return;
  await bumpJob(jobId, { sourcesAttempted: 1 });
  // Census CBP is annual; refresh at most weekly.
  if (src.lastSuccessAt && Date.now() - src.lastSuccessAt.getTime() < 7 * 86_400_000) {
    await jobLog(jobId, "info", "Census CBP data is fresh (<7 days); skipping");
    await bumpJob(jobId, { sourcesSucceeded: 1 });
    return;
  }
  const { rows, errors } = await fetchCbp(src.config as unknown as CbpConfig);
  for (const r of rows) {
    await db
      .insert(marketStats)
      .values({ sourceId: src.id, ...r })
      .onConflictDoUpdate({
        target: [marketStats.sourceId, marketStats.geography, marketStats.naics, marketStats.year],
        set: { establishments: r.establishments, employees: r.employees, annualPayrollThousands: r.annualPayrollThousands, fetchedAt: new Date(), naicsLabel: r.naicsLabel, geoLabel: r.geoLabel },
      });
  }
  const ok = rows.length > 0;
  await markSource("census_cbp", ok, errors.join("; "));
  await bumpJob(jobId, ok ? { sourcesSucceeded: 1, errors: errors.length } : { errors: Math.max(1, errors.length) });
  await jobLog(jobId, ok ? "info" : "error", `Census CBP: ${rows.length} rows, ${errors.length} errors`, errors.slice(0, 5));
}

export async function collectRss(jobId: string | null) {
  const src = await sourceByKey("rss_feeds");
  const feeds = ((src?.config as { feeds?: string[] })?.feeds ?? []).filter(Boolean);
  if (!src?.enabled || !feeds.length) return;
  if (!features.ai()) return jobLog(jobId, "warn", "RSS feeds configured but ANTHROPIC_API_KEY missing; skipping extraction");
  const parser = new Parser();
  for (const feedUrl of feeds) {
    await bumpJob(jobId, { sourcesAttempted: 1 });
    try {
      const res = await politeFetch(feedUrl, "application/rss+xml,application/atom+xml,application/xml,text/xml");
      const feed = await parser.parseString(res.body);
      let discovered = 0;
      for (const item of feed.items.slice(0, 50)) {
        if (!item.link) continue;
        const [seen] = await db.select({ id: listings.id }).from(listings).where(and(eq(listings.sourceId, src.id), eq(listings.url, item.link)));
        if (seen) {
          await db.update(listings).set({ lastSeenAt: new Date() }).where(eq(listings.id, seen.id));
          continue;
        }
        const text = `${item.title ?? ""}\n${item.contentSnippet ?? item.content ?? ""}`;
        const ev = await recordEvidence("rss_feeds", { url: item.link, text, httpStatus: res.status, robotsAllowed: true });
        const { data, usage } = await extractListing(text, item.link);
        await addJobUsage(jobId, usage);
        if (!data.isBusinessForSale) continue;
        const r = await ingestCandidate({ candidate: data, sourceKey: "rss_feeds", url: item.link, sourceRecordId: ev.sourceRecordId, provenance: "SELLER_REPORTED", jobId });
        if (r.created) discovered++;
        else if (r.changes.length) await bumpJob(jobId, { updated: 1 });
      }
      await bumpJob(jobId, { sourcesSucceeded: 1, discovered });
      await markSource("rss_feeds", true);
      await jobLog(jobId, "info", `RSS ${feedUrl}: ${discovered} new`);
    } catch (e) {
      await bumpJob(jobId, { errors: 1 });
      await markSource("rss_feeds", false, `${feedUrl}: ${(e as Error).message}`);
      await jobLog(jobId, "error", `RSS ${feedUrl} failed: ${(e as Error).message}`);
    }
  }
}

export async function collectWebDiscovery(jobId: string | null) {
  const src = await sourceByKey("claude_web_search");
  if (!src?.enabled || !features.ai()) return;
  await bumpJob(jobId, { sourcesAttempted: 1 });
  try {
    const [pref] = await db.select().from(preferences).limit(1);
    const known = await db.select({ url: listings.url }).from(listings).orderBy(desc(listings.lastSeenAt)).limit(200);
    const res = await discoverListings(
      {
        states: pref?.primaryStates ?? ["TX"],
        metros: pref?.primaryMetros ?? ["Dallas-Fort Worth"],
        maxAskingPrice: pref?.maxAskingPrice ?? null,
        minCashFlow: pref?.minOwnerIncome ?? 100_000,
      },
      known.map((k) => k.url),
    );
    await addJobUsage(jobId, res.usage);
    let discovered = 0;
    for (const c of res.candidates) {
      const ev = await recordEvidence("claude_web_search", { url: c.url, text: `${c.title}\n${c.whyRelevant}` });
      const r = await ingestCandidate({
        candidate: { ...c, description: c.whyRelevant, listingStatus: "UNKNOWN" } satisfies Candidate,
        sourceKey: "claude_web_search",
        url: c.url,
        sourceRecordId: ev.sourceRecordId,
        provenance: "SELLER_REPORTED",
        jobId,
      });
      if (r.created) discovered++;
      else if (r.changes.length) await bumpJob(jobId, { updated: 1 });
    }
    await bumpJob(jobId, { sourcesSucceeded: 1, discovered });
    await markSource("claude_web_search", true);
    await jobLog(jobId, "info", `Web discovery: ${res.candidates.length} candidates (${discovered} new, ${res.rejected} rejected for URLs not in search results)`);
  } catch (e) {
    await bumpJob(jobId, { errors: 1 });
    await markSource("claude_web_search", false, (e as Error).message);
    await jobLog(jobId, "error", `Web discovery failed: ${(e as Error).message}`);
  }
}

/** Archive automated-source opportunities not re-confirmed in 90 days (watchlisted ones are kept). */
export async function archiveStale(jobId: string | null) {
  const watched = db.select({ id: watchlistItems.opportunityId }).from(watchlistItems);
  const rows = await db
    .update(opportunities)
    .set({ listingStatus: "ARCHIVED" })
    .where(
      and(
        lt(opportunities.lastVerifiedAt, new Date(Date.now() - 90 * 86_400_000)),
        notInArray(opportunities.listingStatus, ["ARCHIVED"]),
        notInArray(opportunities.id, watched),
      ),
    )
    .returning({ id: opportunities.id });
  if (rows.length) await jobLog(jobId, "info", `Archived ${rows.length} stale opportunities`);
}

// ───────────────────────── Deep research ─────────────────────────

export async function researchOpportunityById(opportunityId: string, jobId: string | null) {
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
  if (!opp) throw new Error("Opportunity not found");
  await db.update(opportunities).set({ researchStatus: "RESEARCHING" }).where(eq(opportunities.id, opportunityId));
  try {
    const ls = await db
      .select({ url: listings.url, excerpt: sourceRecords.excerpt })
      .from(listings)
      .leftJoin(sourceRecords, eq(listings.sourceRecordId, sourceRecords.id))
      .where(eq(listings.opportunityId, opportunityId));
    const market = opp.naicsCode
      ? await db.select().from(marketStats).where(sql`${marketStats.naics} = ${opp.naicsCode} or ${opp.naicsCode} like ${marketStats.naics} || '%'`)
      : [];
    const [pref] = await db.select().from(preferences).limit(1);
    const inputs = pref ? calculatorInputsFor(pref, opp) : null;
    const base = inputs ? calculate(inputs) : null;

    const result = await researchOpportunity({
      ...opp,
      listingExcerpts: ls.filter((l) => l.excerpt).map((l) => ({ url: l.url, text: l.excerpt! })),
      marketContext: market.length
        ? market.map((m) => `${m.naicsLabel} (NAICS ${m.naics}), ${m.geoLabel}, ${m.year}: ${m.establishments ?? "n/a"} establishments, ${m.employees ?? "n/a"} employees`).join("\n")
        : null,
      financialSummary: base
        ? `Base case with buyer's assumptions: debt service ${money(base.annualDebtService)}/yr, DSCR ${base.dscr ?? "n/a"}, est. after-tax cash to owner ${money(base.afterTaxCashToOwner)}/yr, upfront cash ${money(base.upfrontInvestment)}.`
        : null,
    });
    await addJobUsage(jobId, result.usage);

    const evidenceUrls = new Set([...result.searchResults.map((r) => r.url), ...result.citations.map((c) => c.url), ...ls.map((l) => l.url)]);
    const { report, flags } = auditReport(result.data, {
      evidenceUrls,
      askingPrice: opp.askingPrice,
      revenue: opp.revenue,
      cashFlow: opp.cashFlow,
      bestFinancialProvenance: await bestProvenance(opportunityId),
    });

    const [{ v }] = await db.select({ v: sql<number>`coalesce(max(${researchReports.version}), 0)` }).from(researchReports).where(eq(researchReports.opportunityId, opportunityId));
    const cost = costUsd(result.usage);
    const [saved] = await db
      .insert(researchReports)
      .values({
        opportunityId,
        version: Number(v) + 1,
        jobId,
        recommendation: report.recommendation,
        summary: report.summary,
        sections: report as never,
        auditFlags: flags,
        model: env().AI_MODEL,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        webSearches: result.usage.webSearches,
        costUsd: cost === null ? null : cost.toFixed(4),
      })
      .returning({ id: researchReports.id });

    // Citations: the model's inline web citations + verified finding URLs.
    const cites = new Map<string, { url: string; title: string | null; citedText: string | null; section: string; provenance: "THIRD_PARTY" | "SELLER_REPORTED" }>();
    for (const c of result.citations) cites.set(c.url, { ...c, section: "research", provenance: "THIRD_PARTY" });
    for (const l of ls) if (!l.url.startsWith("document:")) cites.set(l.url, { url: l.url, title: "Original listing", citedText: null, section: "listing", provenance: "SELLER_REPORTED" });
    if (cites.size) await db.insert(researchCitations).values([...cites.values()].map((c) => ({ reportId: saved.id, ...c })));

    await db.update(opportunities).set({ researchStatus: opp.cashFlow == null || opp.askingPrice == null ? "NEEDS_INFO" : "RESEARCHED" }).where(eq(opportunities.id, opportunityId));
    await scoreOpportunity(opportunityId);
    await bumpJob(jobId, { researched: 1 });
    await jobLog(jobId, "info", `Researched "${opp.title}" → ${report.recommendation}${flags.length ? ` (${flags.length} audit flags)` : ""}`);
    return saved.id;
  } catch (e) {
    await db.update(opportunities).set({ researchStatus: "FAILED" }).where(eq(opportunities.id, opportunityId));
    await bumpJob(jobId, { errors: 1 });
    await jobLog(jobId, "error", `Research failed for ${opportunityId}: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * Preliminary screen: choose which queued opportunities deserve paid deep research.
 * Those with price + cash flow that clear the minimum income come first.
 */
export async function selectForResearch(limit: number) {
  const queued = await db
    .select()
    .from(opportunities)
    .where(and(inArray(opportunities.researchStatus, ["QUEUED", "NEW"]), notInArray(opportunities.listingStatus, ["ARCHIVED", "OFF_MARKET"])))
    .limit(200);
  const [pref] = await db.select().from(preferences).limit(1);
  const ranked = queued
    .map((o) => {
      const inputs = pref ? calculatorInputsFor(pref, o) : null;
      const cash = inputs ? calculate(inputs).afterTaxCashToOwner : null;
      const rank = cash === null ? -1e9 + (o.cashFlow ?? 0) : cash;
      return { o, rank, passes: cash === null || !pref || cash >= pref.minOwnerIncome * 0.6 };
    })
    .filter((x) => x.passes)
    .sort((a, b) => b.rank - a.rank);
  // Opportunities screened out are scored (cheap) but not deep-researched.
  return ranked.slice(0, limit).map((x) => x.o.id);
}

export async function runResearchCycle(jobId: string) {
  await jobLog(jobId, "info", "Research cycle started");
  await collectMarketData(jobId);
  await collectRss(jobId);
  await collectWebDiscovery(jobId);
  await archiveStale(jobId);

  if (features.ai()) {
    const budget = env().AI_DAILY_BUDGET_USD;
    const ids = await selectForResearch(env().RESEARCH_MAX_PER_RUN);
    for (const id of ids) {
      const spent = await aiSpendLast24h();
      if (spent !== null && spent >= budget) {
        await jobLog(jobId, "warn", `AI budget reached ($${spent.toFixed(2)} ≥ $${budget}); remaining research deferred`);
        break;
      }
      await researchOpportunityById(id, jobId).catch(() => undefined);
    }
  } else {
    await jobLog(jobId, "warn", "ANTHROPIC_API_KEY not set — discovery and deep research skipped");
  }

  // Re-score everything that changed recently (cheap, deterministic).
  const recent = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(or(isNull(opportunities.lastVerifiedAt), sql`${opportunities.updatedAt} > now() - interval '2 days'`));
  for (const r of recent) await scoreOpportunity(r.id);
  await jobLog(jobId, "info", "Research cycle finished");
}

