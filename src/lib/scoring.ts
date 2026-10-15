/**
 * Transparent opportunity scoring (0–100). Pure and unit-tested.
 *
 * Every category returns a score, the evidence behind it, and whether it was
 * computed from data or defaulted. Income-driven categories are capped by
 * evidence confidence so high projected income with weak evidence cannot
 * produce a high score.
 */
import type { CalculatorResult } from "./finance/calculator";
import type { ResearchReportData } from "./ai/schemas";

export const CATEGORIES = [
  "sustainableOwnerIncome",
  "riskAdjustedReturns",
  "marketDemand",
  "operationalSimplicity",
  "scalability",
  "capitalEfficiency",
  "competitiveAdvantage",
  "evidenceQuality",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Weights = Record<Category, number>;

export const DEFAULT_WEIGHTS: Weights = {
  sustainableOwnerIncome: 25,
  riskAdjustedReturns: 20,
  marketDemand: 15,
  operationalSimplicity: 10,
  scalability: 10,
  capitalEfficiency: 10,
  competitiveAdvantage: 5,
  evidenceQuality: 5,
};

export const CATEGORY_LABELS: Record<Category, string> = {
  sustainableOwnerIncome: "Sustainable owner income",
  riskAdjustedReturns: "Risk-adjusted financial returns",
  marketDemand: "Market demand and growth",
  operationalSimplicity: "Operational simplicity",
  scalability: "Scalability",
  capitalEfficiency: "Capital efficiency",
  competitiveAdvantage: "Competitive advantage",
  evidenceQuality: "Evidence quality",
};

export function normalizeWeights(w: Partial<Weights> | null | undefined): Weights {
  const merged = { ...DEFAULT_WEIGHTS, ...(w ?? {}) };
  for (const k of CATEGORIES) if (!(merged[k] >= 0)) merged[k] = 0;
  const sum = CATEGORIES.reduce((s, k) => s + merged[k], 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(CATEGORIES.map((k) => [k, (merged[k] / sum) * 100])) as Weights;
}

export interface ScoreInput {
  opportunity: {
    askingPrice: number | null;
    revenue: number | null;
    cashFlow: number | null;
    state: string | null;
    metro: string | null;
    industry: string | null;
    lastVerifiedAt: Date | null;
  };
  bestFinancialProvenance: "VERIFIED" | "SELLER_REPORTED" | "THIRD_PARTY" | "AI_ESTIMATE" | null;
  base: CalculatorResult | null;
  conservative: CalculatorResult | null;
  report: ResearchReportData | null;
  citationCount: number;
  auditFlagCount: number;
  preferences: {
    targetOwnerIncome: number;
    minOwnerIncome: number;
    stretchOwnerIncome: number;
    capitalBudget: number | null;
    primaryStates: string[];
    primaryMetros: string[];
    includeNationwide: boolean;
    excludedIndustries: string[];
    ownershipPreference: "OWNER_OPERATED" | "SEMI_ABSENTEE" | "EITHER";
  };
  weights?: Partial<Weights> | null;
  now?: Date;
}

export interface CategoryScore {
  category: Category;
  label: string;
  score: number;
  rawScore: number;
  weight: number;
  weighted: number;
  computed: boolean;
  capped: boolean;
  evidence: string[];
}

export interface ScoreResult {
  total: number;
  attractiveness: number;
  feasibility: number;
  confidence: number;
  fit: number;
  breakdown: CategoryScore[];
  fitReasons: string[];
  weights: Weights;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + ((clamp(x, Math.min(x0, x1), Math.max(x0, x1)) - x0) / (x1 - x0)) * (y1 - y0);
const fromRating = (r: number | null | undefined) => (r ? (r - 1) * 25 : null);
const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function confidenceScore(i: ScoreInput): { score: number; evidence: string[] } {
  const e: string[] = [];
  let s = 0;
  const o = i.opportunity;
  if (o.askingPrice !== null) (s += 15), e.push("Asking price disclosed (+15)");
  else e.push("Asking price not disclosed (+0)");
  if (o.cashFlow !== null) (s += 20), e.push("Cash flow disclosed (+20)");
  else e.push("Cash flow not disclosed (+0)");
  if (o.revenue !== null) (s += 10), e.push("Revenue disclosed (+10)");
  const prov = { VERIFIED: 30, THIRD_PARTY: 15, SELLER_REPORTED: 10, AI_ESTIMATE: 0 } as const;
  if (i.bestFinancialProvenance) {
    s += prov[i.bestFinancialProvenance];
    e.push(`Best financial evidence: ${i.bestFinancialProvenance.replace("_", " ").toLowerCase()} (+${prov[i.bestFinancialProvenance]})`);
  }
  const cites = Math.min(15, i.citationCount * 5);
  if (cites) (s += cites), e.push(`${i.citationCount} cited source(s) in research (+${cites})`);
  if (o.lastVerifiedAt && (i.now ?? new Date()).getTime() - o.lastVerifiedAt.getTime() < 14 * 86_400_000) (s += 10), e.push("Listing verified in last 14 days (+10)");
  if (i.auditFlagCount) (s -= i.auditFlagCount * 3), e.push(`${i.auditFlagCount} audit flag(s) (−${i.auditFlagCount * 3})`);
  return { score: Math.round(clamp(s)), evidence: e };
}

export function score(i: ScoreInput): ScoreResult {
  const weights = normalizeWeights(i.weights);
  const p = i.preferences;
  const conf = confidenceScore(i);
  // Income-driven categories can't exceed 40 + 0.6 × confidence.
  const cap = 40 + 0.6 * conf.score;
  const out: Record<Category, Omit<CategoryScore, "category" | "label" | "weight" | "weighted">> = {} as never;

  // Sustainable owner income (base case, after debt and estimated tax)
  if (i.base) {
    const inc = i.base.afterTaxCashToOwner;
    const raw =
      inc <= 0 ? 0 : inc < p.minOwnerIncome ? lerp(inc, 0, p.minOwnerIncome, 0, 40) : inc < p.targetOwnerIncome ? lerp(inc, p.minOwnerIncome, p.targetOwnerIncome, 40, 75) : lerp(inc, p.targetOwnerIncome, p.stretchOwnerIncome, 75, 100);
    out.sustainableOwnerIncome = { rawScore: raw, score: Math.min(raw, cap), computed: true, capped: raw > cap, evidence: [`Base-case cash to owner after debt & est. tax: ${$(inc)}/yr`, `Target ${$(p.targetOwnerIncome)}, minimum ${$(p.minOwnerIncome)}`] };
  } else out.sustainableOwnerIncome = { rawScore: 0, score: 0, computed: false, capped: false, evidence: ["Not computable — asking price or cash flow not disclosed"] };

  // Risk-adjusted returns (DSCR + conservative-case survival)
  if (i.base && i.conservative) {
    const d = i.base.dscr;
    const dscrScore = d === null ? 90 : d < 1 ? 0 : d < 1.25 ? lerp(d, 1, 1.25, 20, 50) : d < 2 ? lerp(d, 1.25, 2, 50, 85) : lerp(d, 2, 3, 85, 100);
    const c = i.conservative.afterTaxCashToOwner;
    const consScore = c >= p.minOwnerIncome ? 100 : c > 0 ? 50 : 0;
    const raw = 0.6 * dscrScore + 0.4 * consScore;
    out.riskAdjustedReturns = { rawScore: raw, score: Math.min(raw, cap), computed: true, capped: raw > cap, evidence: [d === null ? "No debt (cash purchase)" : `DSCR ${d.toFixed(2)}×`, `Conservative case cash to owner: ${$(c)}/yr`] };
  } else out.riskAdjustedReturns = { rawScore: 0, score: 0, computed: false, capped: false, evidence: ["Not computable without price and cash flow"] };

  // Capital efficiency
  if (i.base && i.base.cashOnCashReturnPct !== null) {
    const coc = i.base.cashOnCashReturnPct;
    let raw = lerp(coc, 0, 40, 0, 100);
    const ev = [`Cash-on-cash return ${coc.toFixed(1)}% on ${$(i.base.upfrontInvestment)} upfront`];
    if (p.capitalBudget !== null && i.base.upfrontInvestment > p.capitalBudget) {
      raw *= 0.5;
      ev.push(`Upfront investment exceeds your capital budget of ${$(p.capitalBudget)} (×0.5)`);
    }
    out.capitalEfficiency = { rawScore: raw, score: Math.min(raw, cap), computed: true, capped: raw > cap, evidence: ev };
  } else out.capitalEfficiency = { rawScore: 0, score: 0, computed: false, capped: false, evidence: ["Not computable"] };

  // Qualitative categories from the research report (neutral 50 when absent, marked not computed)
  const qual = (cat: Category, r: number | null | undefined, text: string | undefined) => {
    const v = fromRating(r);
    out[cat] = v === null ? { rawScore: 50, score: 50, computed: false, capped: false, evidence: ["No research rating yet — neutral default"] } : { rawScore: v, score: v, computed: true, capped: false, evidence: [`AI research rating ${r}/5`, ...(text ? [text.slice(0, 200)] : [])] };
  };
  qual("marketDemand", i.report?.marketDemand.rating, i.report?.marketDemand.assessment);
  qual("operationalSimplicity", i.report?.operations.simplicityRating, i.report?.operations.laborRequirements);
  qual("scalability", i.report?.scalability.rating, i.report?.scalability.assessment);
  qual("competitiveAdvantage", i.report?.competition.rating, i.report?.competition.assessment);

  out.evidenceQuality = { rawScore: conf.score, score: conf.score, computed: true, capped: false, evidence: conf.evidence };

  const breakdown: CategoryScore[] = CATEGORIES.map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    ...out[c],
    score: Math.round(out[c].score),
    rawScore: Math.round(out[c].rawScore),
    weight: Math.round(weights[c] * 10) / 10,
    weighted: Math.round(out[c].score * weights[c]) / 100,
  }));
  const total = Math.round(breakdown.reduce((s, b) => s + b.weighted, 0));
  const avg = (cs: Category[]) => Math.round(cs.reduce((s, c) => s + out[c].score, 0) / cs.length);

  // Fit with personal goals
  const fitReasons: string[] = [];
  let fit = 100;
  const o = i.opportunity;
  const inPrimaryState = o.state && p.primaryStates.includes(o.state.toUpperCase());
  const inPrimaryMetro = o.metro && p.primaryMetros.some((m) => o.metro!.toLowerCase().includes(m.toLowerCase().split("-")[0]));
  if (inPrimaryMetro) fitReasons.push(`In your priority metro (${o.metro})`);
  else if (inPrimaryState) (fit -= 10), fitReasons.push(`In ${o.state}, outside your priority metro`);
  else if (!o.state) (fit -= 20), fitReasons.push("Location not disclosed");
  else if (p.includeNationwide) (fit -= 30), fitReasons.push(`Outside Texas (${o.state}) — secondary geography`);
  else (fit -= 70), fitReasons.push(`Outside your geography (${o.state})`);
  if (o.industry && p.excludedIndustries.some((x) => o.industry!.toLowerCase().includes(x.toLowerCase()))) (fit = 0), fitReasons.push(`Industry excluded in your settings (${o.industry})`);
  if (i.base) {
    if (i.base.meetsTarget) fitReasons.push("Base case meets your target income");
    else if (i.base.meetsMinimum) (fit -= 10), fitReasons.push("Base case meets minimum but not target income");
    else (fit -= 35), fitReasons.push("Base case below your minimum income");
    if (p.capitalBudget !== null && i.base.upfrontInvestment > p.capitalBudget) (fit -= 25), fitReasons.push("Upfront cash exceeds your capital budget");
  }
  const inv = i.report?.operations.ownerInvolvement;
  if (inv && inv !== "UNKNOWN" && p.ownershipPreference === "SEMI_ABSENTEE" && inv === "HIGH") (fit -= 20), fitReasons.push("High owner involvement vs. your semi-absentee preference");
  if (inv === "LOW") fitReasons.push("Low owner involvement reported — semi-absentee potential");

  return {
    total,
    attractiveness: avg(["marketDemand", "operationalSimplicity", "scalability", "competitiveAdvantage"]),
    feasibility: avg(["sustainableOwnerIncome", "riskAdjustedReturns", "capitalEfficiency"]),
    confidence: conf.score,
    fit: Math.round(clamp(fit)),
    breakdown,
    fitReasons,
    weights,
  };
}
