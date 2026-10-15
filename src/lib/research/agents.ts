/**
 * AI agents. Each agent gets untrusted content wrapped by guard.ts, returns
 * schema-validated output, and has no side-effecting tools.
 *
 *  Agent 1  discoverListings   — web search for public listings (URLs must come from results)
 *  —        extractListing     — listing text → structured fields (no web access)
 *  Agents 2–4 researchOpportunity — business, financial observations, risk (with web search)
 *  Agent 6  auditReport (audit.ts) — deterministic evidence check, run by the pipeline
 */
import { getProvider, addUsage, emptyUsage, type Usage, type SearchSource, type Citation } from "@/lib/ai/provider";
import { SYSTEM_GUARD, wrapUntrusted } from "@/lib/ai/guard";
import { DiscoveryResult, ListingExtraction, ResearchReportSchema, type ResearchReportData } from "@/lib/ai/schemas";
import { normalizeUrl } from "@/lib/ai/audit";
import { money } from "@/lib/format";
import { env } from "@/lib/env";

function requireProvider() {
  const p = getProvider();
  if (!p) throw new Error("AI is not configured — set ANTHROPIC_API_KEY.");
  return p;
}

const NO_FABRICATION = `Accuracy rules:
- Never invent businesses, listings, prices, revenue, cash flow, EBITDA, SDE, owner names, or URLs.
- If a figure is not explicitly stated in the evidence, use null. Do not estimate figures into data fields.
- Distinguish SELLER_REPORTED (listing/broker claims), THIRD_PARTY (independent cited sources) and AI_ESTIMATE (your reasoning).`;

// ───────────────────────── Extraction ─────────────────────────

export async function extractListing(text: string, url: string | null): Promise<{ data: ListingExtraction; usage: Usage }> {
  const p = requireProvider();
  return p.structured({
    system: `You extract structured facts from business-for-sale listings for a personal acquisition research tool.\n${NO_FABRICATION}\n${SYSTEM_GUARD}`,
    prompt: `Extract the listing below. Copy figures exactly as stated (convert "$1.2M" to 1200000). Use null for anything not stated.\n\n${wrapUntrusted("listing", text, { url })}`,
    schema: ListingExtraction,
    toolName: "record_listing",
    toolDescription: "Record the structured listing facts.",
    maxTokens: 3000,
  });
}

// ───────────────────────── Discovery (Agent 1) ─────────────────────────

export interface DiscoveryPrefs {
  states: string[];
  metros: string[];
  maxAskingPrice: number | null;
  minCashFlow: number;
}

export async function discoverListings(prefs: DiscoveryPrefs, knownUrls: string[]) {
  const p = requireProvider();
  const geo = [...prefs.metros, ...prefs.states.filter((s) => s !== "TX"), "Texas"].join(", ");
  const research = await p.research({
    system: `You are a business-acquisition sourcing analyst. Find specific businesses and franchise resales currently listed for sale on public web pages.\n${NO_FABRICATION}\n${SYSTEM_GUARD}`,
    prompt: `Search the web for specific, currently listed businesses for sale in ${geo}.
Criteria: reported cash flow / SDE of roughly ${money(prefs.minCashFlow)} or more${prefs.maxAskingPrice ? `, asking price up to ${money(prefs.maxAskingPrice)}` : ""}.
Favor recurring-revenue service businesses (commercial cleaning, HVAC/plumbing service, pest control, landscaping, IT/managed services, equipment rental, B2B services), semi-absentee operations, and listings mentioning seller financing — but include any legal mainstream industry.
Only report individual listing pages (not search-result or category pages). For each, give the URL and only the figures stated on the page.
Skip these already-known URLs:\n${knownUrls.slice(0, 200).join("\n") || "(none)"}`,
    webSearch: { maxUses: env().DISCOVERY_MAX_SEARCHES },
  });

  const allowed = new Set([...research.searchResults.map((r) => r.url), ...research.citations.map((c) => c.url)].map(normalizeUrl));
  const known = new Set(knownUrls.map(normalizeUrl));
  if (!allowed.size) return { candidates: [], rejected: 0, usage: research.usage, evidence: research.searchResults };

  const structured = await p.structured({
    system: `Convert research notes into structured listing candidates.\n${NO_FABRICATION}\nEvery candidate URL must be one of the allowed URLs.`,
    prompt: `Allowed URLs (from actual search results):\n${[...allowed].join("\n")}\n\nResearch notes:\n${wrapUntrusted("research_notes", research.text)}`,
    schema: DiscoveryResult,
    toolName: "record_candidates",
    toolDescription: "Record the listing candidates found.",
  });
  const valid = structured.data.candidates.filter((c) => allowed.has(normalizeUrl(c.url)) && !known.has(normalizeUrl(c.url)));
  return {
    candidates: valid,
    rejected: structured.data.candidates.length - valid.length,
    usage: addUsage(research.usage, structured.usage),
    evidence: research.searchResults,
  };
}

// ───────────────────────── Research (Agents 2–4) ─────────────────────────

export interface ResearchSubject {
  title: string;
  type: string;
  industry: string | null;
  city: string | null;
  state: string | null;
  askingPrice: number | null;
  revenue: number | null;
  cashFlow: number | null;
  ebitda: number | null;
  yearEstablished: number | null;
  sellerFinancing: boolean | null;
  description: string | null;
  listingExcerpts: { url: string; text: string }[];
  marketContext: string | null;
  financialSummary: string | null;
}

export async function researchOpportunity(s: ResearchSubject): Promise<{
  data: ResearchReportData;
  usage: Usage;
  searchResults: SearchSource[];
  citations: Citation[];
}> {
  const p = requireProvider();
  let usage = emptyUsage();
  const facts = `Title: ${s.title}
Type: ${s.type}
Industry: ${s.industry ?? "not disclosed"}
Location: ${[s.city, s.state].filter(Boolean).join(", ") || "not disclosed"}
Asking price: ${money(s.askingPrice)} | Revenue: ${money(s.revenue)} | Cash flow/SDE: ${money(s.cashFlow)} | EBITDA: ${money(s.ebitda)}
Established: ${s.yearEstablished ?? "not disclosed"} | Seller financing: ${s.sellerFinancing === null ? "not disclosed" : s.sellerFinancing ? "yes" : "no"}`;

  const research = await p.research({
    system: `You are a team of acquisition analysts (business, market, risk) researching one small business for a buyer in Dallas-Fort Worth whose goal is $100k–$200k/yr sustainable owner income.\n${NO_FABRICATION}\n${SYSTEM_GUARD}`,
    prompt: `Research this opportunity. Use web search for industry demand, local (DFW/Texas) market conditions, competition, regulation/licensing, labor and typical risks for this kind of business. Cite sources.

Known facts (seller-reported unless noted):
${facts}

${s.financialSummary ? `Buyer's calculator output (deterministic, from the figures above):\n${s.financialSummary}\n` : ""}
${s.marketContext ? `Official market data (U.S. Census County Business Patterns):\n${s.marketContext}\n` : ""}
Listing content:
${s.listingExcerpts.map((l) => wrapUntrusted("listing", l.text, { url: l.url })).join("\n") || "(no listing text available)"}`,
    webSearch: { maxUses: 5 },
  });
  usage = addUsage(usage, research.usage);

  const evidenceUrls = [...new Set([...research.searchResults.map((r) => r.url), ...research.citations.map((c) => c.url), ...s.listingExcerpts.map((l) => l.url)])];
  const structured = await p.structured({
    system: `Turn the research notes into a structured acquisition research report.\n${NO_FABRICATION}\n${SYSTEM_GUARD}
Ratings: use null when evidence is insufficient. sourceUrl must be one of the evidence URLs or null.
Recommendation: STRONG_CANDIDATE only with solid evidence; INSUFFICIENT_DATA when price or cash flow is missing.`,
    prompt: `Opportunity facts:\n${facts}\n\nEvidence URLs:\n${evidenceUrls.join("\n")}\n\nResearch notes:\n${wrapUntrusted("research_notes", research.text)}`,
    schema: ResearchReportSchema,
    toolName: "record_research_report",
    toolDescription: "Record the structured research report.",
  });
  usage = addUsage(usage, structured.usage);
  return { data: structured.data, usage, searchResults: research.searchResults, citations: research.citations };
}
