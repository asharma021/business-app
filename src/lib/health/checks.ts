/**
 * Live connection checks for every external dependency. Used by the
 * "Check connections" button and `npm run check:integrations`.
 * Each check makes the smallest real request that proves the integration works.
 */
import Anthropic from "@anthropic-ai/sdk";
import { desc, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import { sources, workerHeartbeats } from "@/db/schema";
import { env } from "@/lib/env";
import { buildCbpUrl, parseCbpResponse, type CbpConfig } from "@/lib/sources/census";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  ms: number;
}

async function timed(name: string, fn: () => Promise<{ status: CheckStatus; detail: string }>): Promise<CheckResult> {
  const t = Date.now();
  try {
    return { name, ...(await fn()), ms: Date.now() - t };
  } catch (e) {
    return { name, status: "fail", detail: (e as Error).message.slice(0, 500), ms: Date.now() - t };
  }
}

export const checkDatabase = () =>
  timed("Database", async () => {
    const r = await db.execute<{ v: string; n: number }>(sql`select version() as v, (select count(*)::int from source) as n`);
    const row = r.rows[0];
    return { status: row.n > 0 ? "ok" : "warn", detail: `${row.v.split(" ").slice(0, 2).join(" ")}; ${row.n} sources registered${row.n ? "" : " — run npm run db:migrate"}` };
  });

export const checkWorker = () =>
  timed("Background worker", async () => {
    const [hb] = await db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastBeatAt)).limit(1);
    if (!hb) return { status: "fail", detail: "No heartbeat yet — the worker service has never started against this database." };
    const mins = Math.round((Date.now() - hb.lastBeatAt.getTime()) / 60_000);
    // The dispatcher beats every 10 minutes.
    return mins <= 15
      ? { status: "ok", detail: `Last heartbeat ${mins} min ago (host ${hb.host ?? "?"}, up since ${hb.startedAt.toISOString().slice(0, 16)}Z)` }
      : { status: "fail", detail: `Last heartbeat ${mins} min ago — the worker appears to be down.` };
  });

export const checkAnthropic = (opts: { webSearch?: boolean } = {}) =>
  timed(opts.webSearch ? "Anthropic API (web search)" : "Anthropic API", async () => {
    const e = env();
    if (!e.ANTHROPIC_API_KEY) return { status: "skipped", detail: "ANTHROPIC_API_KEY not set — AI extraction, discovery and research are off." };
    const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
    if (!opts.webSearch) {
      const res = await client.messages.create({ model: e.AI_MODEL, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] });
      return { status: "ok", detail: `Model ${res.model} responded (${res.usage.input_tokens}+${res.usage.output_tokens} tokens).` };
    }
    const res = await client.messages.create({
      model: e.AI_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: "Search the web once for 'U.S. Census County Business Patterns' and reply with one sentence." }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    });
    const searches = res.usage.server_tool_use?.web_search_requests ?? 0;
    const results = res.content.filter((b) => b.type === "web_search_tool_result").length;
    return searches > 0 && results > 0
      ? { status: "ok", detail: `Web search works (${searches} search, about $${(searches * e.AI_WEB_SEARCH_USD_PER_1K / 1000).toFixed(3)}).` }
      : { status: "fail", detail: "The model answered but no web search ran. Web search is on by default; check whether an admin disabled it in the Claude Console (a disabled org returns a 400 'web search is not enabled' error)." };
  });

export const checkCensus = () =>
  timed("Census County Business Patterns API", async () => {
    const [src] = await db.select().from(sources).where(eq(sources.key, "census_cbp"));
    if (!src) return { status: "fail", detail: "census_cbp source missing — run npm run db:migrate" };
    const cfg = src.config as unknown as CbpConfig;
    const url = buildCbpUrl(cfg, cfg.naics[0], env().CENSUS_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    if (!res.ok) return { status: "fail", detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { status: "fail", detail: `Unexpected non-JSON response (often an invalid key): ${body.slice(0, 160)}` };
    }
    const row = parseCbpResponse(json, cfg, cfg.naics[0]);
    if (!row) return { status: "fail", detail: `Response shape not recognized: ${body.slice(0, 200)}` };
    return {
      status: env().CENSUS_API_KEY ? "ok" : "warn",
      detail: `${row.naicsLabel}, ${row.geoLabel} ${row.year}: ${row.establishments ?? "suppressed"} establishments.${env().CENSUS_API_KEY ? "" : " Works without a key, but set CENSUS_API_KEY for reliable daily use."}`,
    };
  });

export const checkResend = () =>
  timed("Resend (email)", async () => {
    const e = env();
    if (!e.RESEND_API_KEY) return { status: "skipped", detail: "RESEND_API_KEY not set — sign-in links print to the server log and reports aren't emailed." };
    const fromDomain = e.EMAIL_FROM.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase();
    const { data, error } = await new Resend(e.RESEND_API_KEY).domains.list();
    if (error) {
      // Sending-only keys can't list domains; that's fine, but we can't confirm the domain here.
      return { status: "warn", detail: `Key accepted but can't list domains (${error.message}). Use "Send test email" to confirm delivery.` };
    }
    const domain = data?.data.find((d) => d.name.toLowerCase() === fromDomain);
    if (!domain) return { status: "fail", detail: `EMAIL_FROM uses ${fromDomain ?? "an invalid address"}, which isn't a domain in this Resend account.` };
    return domain.status === "verified"
      ? { status: "ok", detail: `Sending domain ${domain.name} is verified.` }
      : { status: "fail", detail: `Sending domain ${domain.name} is ${domain.status} — finish DNS verification in Resend.` };
  });

export async function runAllChecks(opts: { webSearch?: boolean } = {}): Promise<CheckResult[]> {
  const results = await Promise.all([checkDatabase(), checkWorker(), checkAnthropic(), checkCensus(), checkResend()]);
  if (opts.webSearch) results.splice(3, 0, await checkAnthropic({ webSearch: true }));
  return results;
}
