import { describe, expect, it } from "vitest";
import { score, normalizeWeights, DEFAULT_WEIGHTS, type ScoreInput } from "@/lib/scoring";
import { calculate, defaultFinancing, DEFAULT_OPERATING, DEFAULT_TARGETS, scenarios } from "@/lib/finance/calculator";
import { auditReport } from "@/lib/ai/audit";
import type { ResearchReportData } from "@/lib/ai/schemas";

const prefs: ScoreInput["preferences"] = {
  targetOwnerIncome: 150_000, minOwnerIncome: 100_000, stretchOwnerIncome: 250_000, capitalBudget: null,
  primaryStates: ["TX"], primaryMetros: ["Dallas-Fort Worth"], includeNationwide: true, excludedIndustries: [], ownershipPreference: "OWNER_OPERATED",
};
const calcFor = (price: number, sde: number) => {
  const s = scenarios({ deal: { purchasePrice: price, sde }, financing: defaultFinancing("SBA_STYLE", price), operating: DEFAULT_OPERATING, targets: DEFAULT_TARGETS });
  return { base: s.BASE, conservative: s.CONSERVATIVE };
};
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  opportunity: { askingPrice: 1_000_000, revenue: 1_500_000, cashFlow: 450_000, state: "TX", metro: "Dallas-Fort Worth", industry: "Commercial cleaning", lastVerifiedAt: new Date() },
  bestFinancialProvenance: "VERIFIED",
  ...calcFor(1_000_000, 450_000),
  report: null, citationCount: 3, auditFlagCount: 0, preferences: prefs, ...over,
});

describe("scoring", () => {
  it("weights normalize to 100", () => {
    const w = normalizeWeights({ ...DEFAULT_WEIGHTS, scalability: 30 });
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });
  it("total equals the sum of weighted category scores", () => {
    const r = score(input());
    expect(r.total).toBe(Math.round(r.breakdown.reduce((s, b) => s + b.weighted, 0)));
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
  it("high projected income with weak evidence cannot score high", () => {
    const strong = score(input());
    const weak = score(input({ bestFinancialProvenance: "AI_ESTIMATE", citationCount: 0, opportunity: { ...input().opportunity, revenue: null, lastVerifiedAt: null } }));
    const inc = (r: ReturnType<typeof score>) => r.breakdown.find((b) => b.category === "sustainableOwnerIncome")!;
    expect(inc(weak).capped).toBe(true);
    expect(inc(weak).score).toBeLessThan(inc(strong).score);
    expect(weak.total).toBeLessThan(strong.total);
    expect(weak.confidence).toBeLessThan(50);
  });
  it("missing financials yields zero (not neutral) financial scores, marked not computed", () => {
    const r = score(input({ base: null, conservative: null, opportunity: { ...input().opportunity, cashFlow: null } }));
    const inc = r.breakdown.find((b) => b.category === "sustainableOwnerIncome")!;
    expect(inc.score).toBe(0);
    expect(inc.computed).toBe(false);
  });
  it("fit penalizes out-of-geography and over-budget deals", () => {
    const home = score(input());
    const away = score(input({ opportunity: { ...input().opportunity, state: "OH", metro: null } }));
    const overBudget = score(input({ preferences: { ...prefs, capitalBudget: 50_000 } }));
    expect(away.fit).toBeLessThan(home.fit);
    expect(overBudget.fit).toBeLessThan(home.fit);
    expect(overBudget.fitReasons.join(" ")).toMatch(/capital budget/);
  });
});

const report = (over: Partial<ResearchReportData> = {}): ResearchReportData => ({
  recommendation: "STRONG_CANDIDATE", summary: "s", whyInteresting: "w", mainRisk: "m", businessModel: "b",
  marketDemand: { rating: 4, assessment: "a", findings: [{ claim: "DFW population grew", provenance: "THIRD_PARTY", sourceUrl: "https://census.gov/x" }, { claim: "fake", provenance: "THIRD_PARTY", sourceUrl: "https://made-up.example/y" }] },
  competition: { rating: 3, assessment: "a", findings: [] },
  operations: { simplicityRating: 3, ownerInvolvement: "MEDIUM", laborRequirements: "l", seasonality: "s", regulatory: "r" },
  scalability: { rating: 3, assessment: "a" },
  financialObservations: [], risks: [{ category: "OTHER", severity: "LOW", description: "d", sourceUrl: "https://made-up.example/z" }],
  dueDiligence: { sellerQuestions: [], documentsToRequest: [], unresolvedConcerns: [] }, dataGaps: [], ...over,
});

describe("research auditor", () => {
  const ctx = { evidenceUrls: new Set(["https://census.gov/x"]), askingPrice: 1, revenue: 1, cashFlow: 1, bestFinancialProvenance: "SELLER_REPORTED" as const };
  it("removes URLs not in the evidence set and relabels unsupported third-party claims", () => {
    const { report: r, flags } = auditReport(report(), ctx);
    expect(r.marketDemand.findings[0].sourceUrl).toBe("https://census.gov/x");
    expect(r.marketDemand.findings[1].sourceUrl).toBeNull();
    expect(r.marketDemand.findings[1].provenance).toBe("AI_ESTIMATE");
    expect(r.risks[0].sourceUrl).toBeNull();
    expect(flags.some((f) => f.includes("Removed unverified source URL"))).toBe(true);
  });
  it("caps STRONG_CANDIDATE when financials are unverified", () => {
    expect(auditReport(report(), ctx).report.recommendation).toBe("PROMISING_NEEDS_VERIFICATION");
    expect(auditReport(report(), { ...ctx, bestFinancialProvenance: "VERIFIED" }).report.recommendation).toBe("STRONG_CANDIDATE");
  });
  it("forces INSUFFICIENT_DATA without price or cash flow", () => {
    expect(auditReport(report(), { ...ctx, cashFlow: null }).report.recommendation).toBe("INSUFFICIENT_DATA");
  });
});
