/**
 * Agent 6 — Research Quality Auditor (deterministic).
 *
 * Runs on every AI report before it is stored:
 *  - removes any URL the model cites that is not in the evidence set
 *  - downgrades confident recommendations that lack financial evidence
 *  - flags missing key financials and estimate-only financial claims
 */
import type { ResearchReportData, Finding } from "./schemas";

export interface AuditContext {
  evidenceUrls: Set<string>;
  askingPrice: number | null;
  revenue: number | null;
  cashFlow: number | null;
  /** best provenance available for the financials */
  bestFinancialProvenance: "VERIFIED" | "SELLER_REPORTED" | "THIRD_PARTY" | "AI_ESTIMATE" | null;
}

export interface AuditOutcome {
  report: ResearchReportData;
  flags: string[];
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(p)) url.searchParams.delete(p);
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

export function auditReport(input: ResearchReportData, ctx: AuditContext): AuditOutcome {
  const flags: string[] = [];
  const evidence = new Set([...ctx.evidenceUrls].map(normalizeUrl));
  const report: ResearchReportData = structuredClone(input);

  const checkUrl = (u: string | null, where: string): string | null => {
    if (!u) return null;
    if (evidence.has(normalizeUrl(u))) return u;
    flags.push(`Removed unverified source URL in ${where}`);
    return null;
  };
  const fixFindings = (list: Finding[], where: string) =>
    list.map((f) => {
      const sourceUrl = checkUrl(f.sourceUrl, where);
      // A THIRD_PARTY claim with no verifiable source is downgraded to an AI estimate.
      const provenance = f.provenance === "THIRD_PARTY" && !sourceUrl ? "AI_ESTIMATE" : f.provenance;
      if (provenance !== f.provenance) flags.push(`Unsupported third-party claim relabeled as AI estimate (${where})`);
      return { ...f, sourceUrl, provenance };
    });

  report.marketDemand.findings = fixFindings(report.marketDemand.findings, "market demand");
  report.competition.findings = fixFindings(report.competition.findings, "competition");
  report.financialObservations = fixFindings(report.financialObservations, "financial observations");
  report.risks = report.risks.map((r) => ({ ...r, sourceUrl: checkUrl(r.sourceUrl, "risks") }));

  const missing: string[] = [];
  if (ctx.askingPrice === null) missing.push("asking price");
  if (ctx.cashFlow === null) missing.push("cash flow / SDE");
  if (ctx.revenue === null) missing.push("revenue");
  if (missing.length) flags.push(`Missing financial data: ${missing.join(", ")}`);
  if (ctx.bestFinancialProvenance === "AI_ESTIMATE") flags.push("Financials are AI estimates only");
  if (ctx.bestFinancialProvenance === "SELLER_REPORTED") flags.push("Financials are seller-reported and unverified");

  // Recommendation guardrails.
  if (ctx.cashFlow === null || ctx.askingPrice === null) {
    if (report.recommendation === "STRONG_CANDIDATE" || report.recommendation === "PROMISING_NEEDS_VERIFICATION") {
      flags.push(`Recommendation downgraded from ${report.recommendation} to INSUFFICIENT_DATA (no price or cash flow)`);
      report.recommendation = "INSUFFICIENT_DATA";
    }
  } else if (report.recommendation === "STRONG_CANDIDATE" && ctx.bestFinancialProvenance !== "VERIFIED") {
    flags.push("Recommendation capped at PROMISING_NEEDS_VERIFICATION until financials are verified");
    report.recommendation = "PROMISING_NEEDS_VERIFICATION";
  }

  return { report, flags: [...new Set(flags)] };
}
