/**
 * Daily intelligence report: assembled deterministically from stored data.
 * Nothing is generated to "fill" sections — empty sections say so.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dataRefreshes,
  financialScenarios,
  listings,
  marketStats,
  opportunities,
  opportunityScores,
  researchJobs,
  researchReports,
  watchlistItems,
  type Preference,
} from "@/db/schema";
import { ResearchReportSchema } from "@/lib/ai/schemas";
import type { CalculatorResult } from "@/lib/finance/calculator";

export interface ReportItem {
  id: string;
  title: string;
  type: string;
  location: string;
  askingPrice: number | null;
  revenue: number | null;
  cashFlow: number | null;
  ownerIncomeAfterFinancing: number | null;
  score: number | null;
  confidence: number | null;
  recommendation: string | null;
  mainRisk: string | null;
  whyInteresting: string | null;
  sourceUrl: string | null;
  note?: string;
}

export interface DailyReportContent {
  reportDate: string;
  generatedAt: string;
  research: { status: string; discovered: number; researched: number; errors: number; finishedAt: string | null } | null;
  executiveSummary: string[];
  newOpportunities: ReportItem[];
  topIncome: ReportItem[];
  franchises: ReportItem[];
  emerging: ReportItem[];
  priceReductions: ReportItem[];
  marketChanges: string[];
  watchlistAlerts: ReportItem[];
  nextActions: string[];
  hasCompellingOpportunities: boolean;
}

export async function buildReportItems(userId: string, ids: string[], notes: Record<string, string> = {}): Promise<ReportItem[]> {
  if (!ids.length) return [];
  const opps = await db.select().from(opportunities).where(inArray(opportunities.id, ids));
  const scores = await db.select().from(opportunityScores).where(and(eq(opportunityScores.userId, userId), inArray(opportunityScores.opportunityId, ids)));
  const scen = await db
    .select()
    .from(financialScenarios)
    .where(and(eq(financialScenarios.userId, userId), eq(financialScenarios.kind, "BASE"), inArray(financialScenarios.opportunityId, ids)));
  const reports = await db
    .selectDistinctOn([researchReports.opportunityId])
    .from(researchReports)
    .where(inArray(researchReports.opportunityId, ids))
    .orderBy(researchReports.opportunityId, desc(researchReports.version));
  const ls = await db.select({ opportunityId: listings.opportunityId, url: listings.url }).from(listings).where(inArray(listings.opportunityId, ids));

  const byId = new Map(opps.map((o) => [o.id, o]));
  return ids
    .map((id) => byId.get(id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .map((o) => {
      const sc = scores.find((s) => s.opportunityId === o.id);
      const base = scen.find((s) => s.opportunityId === o.id)?.outputs as unknown as CalculatorResult | undefined;
      const rep = reports.find((r) => r.opportunityId === o.id);
      const parsed = rep ? ResearchReportSchema.safeParse(rep.sections) : null;
      return {
        id: o.id,
        title: o.title,
        type: o.type,
        location: [o.city, o.state].filter(Boolean).join(", ") || "Location not disclosed",
        askingPrice: o.askingPrice,
        revenue: o.revenue,
        cashFlow: o.cashFlow,
        ownerIncomeAfterFinancing: base?.afterTaxCashToOwner ?? null,
        score: sc?.total ?? null,
        confidence: sc?.confidence ?? null,
        recommendation: rep?.recommendation ?? null,
        mainRisk: parsed?.success ? parsed.data.mainRisk : null,
        whyInteresting: parsed?.success ? parsed.data.whyInteresting : o.description?.slice(0, 300) ?? null,
        sourceUrl: ls.find((l) => l.opportunityId === o.id && /^https?:/.test(l.url))?.url ?? null,
        note: notes[o.id],
      };
    });
}

const byScore = (a: ReportItem, b: ReportItem) => (b.score ?? -1) - (a.score ?? -1);

export async function buildDailyReport(userId: string, pref: Preference, reportDate: string, now = new Date()): Promise<DailyReportContent> {
  const since = new Date(now.getTime() - 24 * 3600_000);

  const [job] = await db
    .select()
    .from(researchJobs)
    .where(gte(researchJobs.createdAt, since))
    .orderBy(desc(researchJobs.createdAt))
    .limit(1);

  const newIds = (
    await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(gte(opportunities.firstDiscoveredAt, since), sql`${opportunities.listingStatus} <> 'ARCHIVED'`))
  ).map((r) => r.id);
  const newItems = (await buildReportItems(userId, newIds)).sort(byScore);

  // Candidates meeting income target (any discovery date), by score.
  const incomeRows = await db
    .select({ id: financialScenarios.opportunityId, out: financialScenarios.outputs })
    .from(financialScenarios)
    .innerJoin(opportunities, eq(opportunities.id, financialScenarios.opportunityId))
    .where(and(eq(financialScenarios.userId, userId), eq(financialScenarios.kind, "BASE"), sql`${opportunities.listingStatus} not in ('ARCHIVED','OFF_MARKET')`, sql`${opportunities.pipelineStatus} <> 'REJECTED'`));
  const meeting = incomeRows.filter((r) => ((r.out as unknown as CalculatorResult).afterTaxCashToOwner ?? 0) >= pref.minOwnerIncome).map((r) => r.id);
  const topIncome = (await buildReportItems(userId, meeting)).sort(byScore).slice(0, 3);

  const priceCuts = await db
    .select()
    .from(dataRefreshes)
    .where(and(eq(dataRefreshes.field, "askingPrice"), gte(dataRefreshes.observedAt, since)));
  const cuts = priceCuts.filter((r) => r.oldValue && r.newValue && Number(r.newValue) < Number(r.oldValue));
  const priceReductions = await buildReportItems(
    userId,
    cuts.map((c) => c.opportunityId),
    Object.fromEntries(cuts.map((c) => [c.opportunityId, `Price cut from $${Number(c.oldValue).toLocaleString()} to $${Number(c.newValue).toLocaleString()}`])),
  );

  const watched = (await db.select({ id: watchlistItems.opportunityId }).from(watchlistItems).where(eq(watchlistItems.userId, userId))).map((w) => w.id);
  const watchChanges = watched.length
    ? await db.select().from(dataRefreshes).where(and(inArray(dataRefreshes.opportunityId, watched), gte(dataRefreshes.observedAt, since)))
    : [];
  const watchlistAlerts = await buildReportItems(
    userId,
    [...new Set(watchChanges.map((w) => w.opportunityId))],
    Object.fromEntries(watchChanges.map((w) => [w.opportunityId, `${w.field} changed: ${w.oldValue ?? "—"} → ${w.newValue ?? "—"}`])),
  );

  const freshMarket = await db.select({ n: sql<number>`count(*)` }).from(marketStats).where(gte(marketStats.fetchedAt, since));
  const marketChanges = Number(freshMarket[0].n) ? [`Refreshed ${freshMarket[0].n} DFW industry data points from the U.S. Census County Business Patterns API.`] : [];

  const compelling = [...newItems, ...topIncome].filter((i) => (i.score ?? 0) >= 60 && (i.confidence ?? 0) >= 40);
  const summary: string[] = [];
  if (job) summary.push(`Research run ${job.status.toLowerCase()}: ${job.discovered} new, ${job.researched} researched, ${job.errors} error(s).`);
  else summary.push("No research run completed in the last 24 hours.");
  summary.push(newItems.length ? `${newItems.length} new opportunit${newItems.length === 1 ? "y" : "ies"} discovered.` : "No new opportunities were discovered.");
  summary.push(
    topIncome.length
      ? `${topIncome.length} tracked opportunit${topIncome.length === 1 ? "y appears" : "ies appear"} able to reach your $${pref.minOwnerIncome.toLocaleString()} minimum after financing (base case, unverified figures).`
      : "No tracked opportunity currently reaches your minimum income after financing.",
  );
  if (!compelling.length) summary.push("No compelling opportunities found today.");

  const nextActions: string[] = [];
  for (const i of topIncome.slice(0, 2)) nextActions.push(`Request P&Ls and tax returns for "${i.title}" to verify reported cash flow.`);
  const needsInfo = await db.select({ n: sql<number>`count(*)` }).from(opportunities).where(eq(opportunities.researchStatus, "NEEDS_INFO"));
  if (Number(needsInfo[0].n)) nextActions.push(`${needsInfo[0].n} opportunit${Number(needsInfo[0].n) === 1 ? "y is" : "ies are"} missing price or cash flow — check the original listings.`);
  if (job && job.errors) nextActions.push("Review research errors on the Research Sources page.");

  return {
    reportDate,
    generatedAt: now.toISOString(),
    research: job ? { status: job.status, discovered: job.discovered, researched: job.researched, errors: job.errors, finishedAt: job.finishedAt?.toISOString() ?? null } : null,
    executiveSummary: summary,
    newOpportunities: newItems.filter((i) => i.type !== "FRANCHISE").slice(0, 5),
    topIncome,
    franchises: newItems.filter((i) => i.type === "FRANCHISE").slice(0, 5),
    emerging: [],
    priceReductions,
    marketChanges,
    watchlistAlerts,
    nextActions,
    hasCompellingOpportunities: compelling.length > 0,
  };
}
