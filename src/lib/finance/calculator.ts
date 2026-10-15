/**
 * Salary Replacement Calculator — pure, deterministic, unit-tested.
 *
 * Key principle: Seller's Discretionary Earnings (SDE) is NOT money you can
 * withdraw. From SDE we subtract a replacement manager (if you won't work in
 * the business), maintenance capex, extra operating costs, debt service and
 * estimated taxes to arrive at cash actually available to you.
 *
 * Every default here is an editable ASSUMPTION, surfaced in the UI as such.
 */

export type FinancingStructure = "SBA_STYLE" | "SBA_PLUS_SELLER" | "CONVENTIONAL" | "SELLER" | "CASH" | "CUSTOM";
export type OwnerRole = "OWNER_OPERATED" | "SEMI_ABSENTEE";

export interface LoanTerms {
  /** share of purchase price financed, 0–1 */
  pct: number;
  /** annual interest rate, percent (e.g. 10.5) */
  ratePct: number;
  termYears: number;
}

export type EarningsBasis = "SDE" | "EBITDA";

export interface DealInputs {
  purchasePrice: number;
  /**
   * Annual earnings the analysis starts from (named `sde` for historical reasons).
   * SDE  = earnings before ONE owner's salary/perks (what most small-business listings report).
   * EBITDA = earnings AFTER paying a market-rate owner/manager salary.
   * Revenue is never treated as earnings.
   */
  sde: number;
  /** defaults to "SDE" */
  earningsBasis?: EarningsBasis;
  /** annual revenue — optional; needed for revenue sensitivity */
  revenue?: number | null;
  /** annual payroll excl. owner — optional; needed for payroll sensitivity */
  payroll?: number | null;
}

export interface FinancingInputs {
  structure: FinancingStructure;
  downPaymentPct: number; // 0–1
  seniorLoan: LoanTerms | null;
  sellerNote: LoanTerms | null;
  closingCostsPct: number; // 0–1 of purchase price
  workingCapitalReserve: number; // $
}

export interface OperatingInputs {
  ownerRole: OwnerRole;
  /** fully-loaded annual cost of a manager replacing the owner (semi-absentee only) */
  managerSalary: number;
  maintenanceCapex: number; // $/yr
  additionalOperatingCosts: number; // $/yr
  /** blended effective tax on owner income (federal + SE tax; TX has no state income tax) */
  effectiveTaxRatePct: number;
  /** contribution margin used to translate revenue declines into SDE declines (0–1) */
  contributionMarginPct: number;
  /** DSCR threshold to flag (common lender guideline; actual requirements vary) */
  dscrThreshold: number;
}

export interface IncomeTargets {
  target: number;
  minimum: number;
  stretch: number;
}

export interface CalculatorInputs {
  deal: DealInputs;
  financing: FinancingInputs;
  operating: OperatingInputs;
  targets: IncomeTargets;
}

export interface LoanResult {
  principal: number;
  monthlyPayment: number;
  annualPayment: number;
  firstYearInterest: number;
}

export interface CalculatorResult {
  earningsBasis: EarningsBasis;
  // Upfront
  downPayment: number;
  closingCosts: number;
  workingCapitalReserve: number;
  upfrontInvestment: number;
  seniorLoan: LoanResult | null;
  sellerNote: LoanResult | null;
  // Annual flows
  sde: number;
  managerCost: number;
  maintenanceCapex: number;
  additionalOperatingCosts: number;
  earningsBeforeDebtService: number;
  annualDebtService: number;
  monthlyDebtService: number;
  dscr: number | null;
  dscrBelowThreshold: boolean;
  preTaxCashToOwner: number;
  estimatedTaxes: number;
  afterTaxCashToOwner: number;
  monthlyAfterTaxCash: number;
  // Goal analysis
  incomeKind: "OWNER_COMPENSATION_FOR_WORKING" | "PASSIVE_INVESTMENT_INCOME";
  meetsMinimum: boolean;
  meetsTarget: boolean;
  meetsStretch: boolean;
  requiredEarningsBeforeDebtService: number;
  requiredSde: number;
  sdeGapToTarget: number;
  breakEvenSde: number;
  cashOnCashReturnPct: number | null;
  paybackYears: number | null;
  warnings: string[];
}

const round = (n: number) => Math.round(n);

export function amortize(principal: number, ratePct: number, termYears: number): LoanResult {
  if (principal <= 0 || termYears <= 0) {
    return { principal: 0, monthlyPayment: 0, annualPayment: 0, firstYearInterest: 0 };
  }
  const n = Math.round(termYears * 12);
  const r = ratePct / 100 / 12;
  const monthly = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  let balance = principal;
  let interest = 0;
  for (let m = 0; m < Math.min(12, n); m++) {
    const i = balance * r;
    interest += i;
    balance -= monthly - i;
  }
  return {
    principal: round(principal),
    monthlyPayment: round(monthly),
    annualPayment: round(monthly * Math.min(12, n)),
    firstYearInterest: round(interest),
  };
}

export const FINANCING_PRESETS: Record<Exclude<FinancingStructure, "CUSTOM">, Omit<FinancingInputs, "workingCapitalReserve">> = {
  // Structure only — SBA eligibility/approval is never assumed. Rates are placeholders: edit to a current quote.
  SBA_STYLE: {
    structure: "SBA_STYLE",
    downPaymentPct: 0.1,
    seniorLoan: { pct: 0.9, ratePct: 10.5, termYears: 10 },
    sellerNote: null,
    closingCostsPct: 0.04,
  },
  SBA_PLUS_SELLER: {
    structure: "SBA_PLUS_SELLER",
    downPaymentPct: 0.1,
    seniorLoan: { pct: 0.8, ratePct: 10.5, termYears: 10 },
    sellerNote: { pct: 0.1, ratePct: 6, termYears: 10 },
    closingCostsPct: 0.04,
  },
  CONVENTIONAL: {
    structure: "CONVENTIONAL",
    downPaymentPct: 0.25,
    seniorLoan: { pct: 0.75, ratePct: 9, termYears: 7 },
    sellerNote: null,
    closingCostsPct: 0.03,
  },
  SELLER: {
    structure: "SELLER",
    downPaymentPct: 0.3,
    seniorLoan: null,
    sellerNote: { pct: 0.7, ratePct: 7, termYears: 5 },
    closingCostsPct: 0.02,
  },
  CASH: { structure: "CASH", downPaymentPct: 1, seniorLoan: null, sellerNote: null, closingCostsPct: 0.02 },
};

export const DEFAULT_OPERATING: OperatingInputs = {
  ownerRole: "OWNER_OPERATED",
  managerSalary: 75000,
  maintenanceCapex: 0,
  additionalOperatingCosts: 0,
  effectiveTaxRatePct: 25,
  contributionMarginPct: 0.5,
  dscrThreshold: 1.25,
};

export const DEFAULT_TARGETS: IncomeTargets = { target: 150000, minimum: 100000, stretch: 250000 };

export function defaultFinancing(structure: Exclude<FinancingStructure, "CUSTOM"> = "SBA_STYLE", purchasePrice = 0): FinancingInputs {
  return { ...FINANCING_PRESETS[structure], workingCapitalReserve: round(purchasePrice * 0.05) };
}

export function validateFinancing(f: FinancingInputs): string[] {
  const errs: string[] = [];
  const total = f.downPaymentPct + (f.seniorLoan?.pct ?? 0) + (f.sellerNote?.pct ?? 0);
  if (Math.abs(total - 1) > 0.001) errs.push(`Down payment + loans must equal 100% of price (currently ${(total * 100).toFixed(1)}%).`);
  for (const [name, l] of [["Senior loan", f.seniorLoan], ["Seller note", f.sellerNote]] as const) {
    if (l && (l.ratePct < 0 || l.ratePct > 40)) errs.push(`${name} rate must be between 0% and 40%.`);
    if (l && (l.termYears <= 0 || l.termYears > 30)) errs.push(`${name} term must be between 0 and 30 years.`);
  }
  return errs;
}

export function calculate(input: CalculatorInputs): CalculatorResult {
  const { deal, financing: f, operating: o, targets } = input;
  const price = deal.purchasePrice;
  const warnings = validateFinancing(f);

  const downPayment = round(price * f.downPaymentPct);
  const closingCosts = round(price * f.closingCostsPct);
  const upfrontInvestment = downPayment + closingCosts + round(f.workingCapitalReserve);

  const seniorLoan = f.seniorLoan ? amortize(price * f.seniorLoan.pct, f.seniorLoan.ratePct, f.seniorLoan.termYears) : null;
  const sellerNote = f.sellerNote ? amortize(price * f.sellerNote.pct, f.sellerNote.ratePct, f.sellerNote.termYears) : null;
  const annualDebtService = (seniorLoan?.annualPayment ?? 0) + (sellerNote?.annualPayment ?? 0);
  const firstYearInterest = (seniorLoan?.firstYearInterest ?? 0) + (sellerNote?.firstYearInterest ?? 0);

  const basis: EarningsBasis = deal.earningsBasis ?? "SDE";
  // EBITDA already deducts a market-rate manager/owner salary, so never subtract one again.
  const managerCost = basis === "SDE" && o.ownerRole === "SEMI_ABSENTEE" ? round(o.managerSalary) : 0;
  const deductions = managerCost + round(o.maintenanceCapex) + round(o.additionalOperatingCosts);
  const ebds = round(deal.sde) - deductions; // earnings before debt service
  const preTaxCashToOwner = ebds - annualDebtService;

  // Taxable ≈ EBDS − interest. Principal is not deductible. Section 197
  // amortization of goodwill is ignored, which overstates tax (conservative).
  const t = o.effectiveTaxRatePct / 100;
  const estimatedTaxes = round(Math.max(0, ebds - firstYearInterest) * t);
  const afterTaxCashToOwner = preTaxCashToOwner - estimatedTaxes;

  // Solve for EBDS that yields target after-tax cash:
  // target = E − DS − t·(E − I)  ⇒  E = (target + DS − t·I) / (1 − t)
  let requiredEbds = t < 1 ? (targets.target + annualDebtService - t * firstYearInterest) / (1 - t) : Infinity;
  if (requiredEbds < firstYearInterest) requiredEbds = targets.target + annualDebtService; // no-tax branch
  requiredEbds = round(requiredEbds);
  const requiredSde = requiredEbds + deductions;

  const dscr = annualDebtService > 0 ? ebds / annualDebtService : null;
  const dscrBelowThreshold = dscr !== null && dscr < o.dscrThreshold;
  if (dscrBelowThreshold)
    warnings.push(`Debt service coverage ${dscr!.toFixed(2)}× is below ${o.dscrThreshold}× — lenders may decline or require more equity.`);
  if (preTaxCashToOwner < 0) warnings.push("Business earnings do not cover debt service under these assumptions.");
  if (basis === "EBITDA")
    warnings.push(
      "Based on EBITDA, which already pays a manager/owner salary. If you run the business yourself you may also draw that salary — it is not included here.",
    );
  else if (o.ownerRole === "OWNER_OPERATED")
    warnings.push("Owner-operated: this cash is compensation for working in the business full-time, not passive income.");

  const cashOnCashReturnPct = upfrontInvestment > 0 ? (afterTaxCashToOwner / upfrontInvestment) * 100 : null;
  const paybackYears = afterTaxCashToOwner > 0 && upfrontInvestment > 0 ? upfrontInvestment / afterTaxCashToOwner : null;

  return {
    earningsBasis: basis,
    downPayment,
    closingCosts,
    workingCapitalReserve: round(f.workingCapitalReserve),
    upfrontInvestment,
    seniorLoan,
    sellerNote,
    sde: round(deal.sde),
    managerCost,
    maintenanceCapex: round(o.maintenanceCapex),
    additionalOperatingCosts: round(o.additionalOperatingCosts),
    earningsBeforeDebtService: ebds,
    annualDebtService,
    monthlyDebtService: round(annualDebtService / 12),
    dscr: dscr === null ? null : Math.round(dscr * 100) / 100,
    dscrBelowThreshold,
    preTaxCashToOwner,
    estimatedTaxes,
    afterTaxCashToOwner,
    monthlyAfterTaxCash: round(afterTaxCashToOwner / 12),
    incomeKind: basis === "SDE" && o.ownerRole === "OWNER_OPERATED" ? "OWNER_COMPENSATION_FOR_WORKING" : "PASSIVE_INVESTMENT_INCOME",
    meetsMinimum: afterTaxCashToOwner >= targets.minimum,
    meetsTarget: afterTaxCashToOwner >= targets.target,
    meetsStretch: afterTaxCashToOwner >= targets.stretch,
    requiredEarningsBeforeDebtService: requiredEbds,
    requiredSde,
    sdeGapToTarget: requiredSde - round(deal.sde),
    breakEvenSde: annualDebtService + deductions,
    cashOnCashReturnPct: cashOnCashReturnPct === null ? null : Math.round(cashOnCashReturnPct * 10) / 10,
    paybackYears: paybackYears === null ? null : Math.round(paybackYears * 10) / 10,
    warnings,
  };
}

// ───────────────────────── Scenarios ─────────────────────────

export interface ScenarioAdjustment {
  sdeMultiplier: number;
  rateDeltaPts: number;
  extraCostPctOfSde: number;
}

/** Scenario adjustments are explicit assumptions and are shown alongside results. */
export const SCENARIO_ADJUSTMENTS: Record<"CONSERVATIVE" | "BASE" | "OPTIMISTIC", ScenarioAdjustment> = {
  CONSERVATIVE: { sdeMultiplier: 0.85, rateDeltaPts: 1.5, extraCostPctOfSde: 0.05 },
  BASE: { sdeMultiplier: 1, rateDeltaPts: 0, extraCostPctOfSde: 0 },
  OPTIMISTIC: { sdeMultiplier: 1.05, rateDeltaPts: -0.5, extraCostPctOfSde: 0 },
};

function bumpRate(l: LoanTerms | null, delta: number): LoanTerms | null {
  return l ? { ...l, ratePct: Math.max(0, l.ratePct + delta) } : null;
}

export function applyAdjustment(input: CalculatorInputs, a: ScenarioAdjustment): CalculatorInputs {
  return {
    ...input,
    deal: { ...input.deal, sde: input.deal.sde * a.sdeMultiplier },
    financing: {
      ...input.financing,
      seniorLoan: bumpRate(input.financing.seniorLoan, a.rateDeltaPts),
      sellerNote: bumpRate(input.financing.sellerNote, a.rateDeltaPts),
    },
    operating: {
      ...input.operating,
      additionalOperatingCosts: input.operating.additionalOperatingCosts + input.deal.sde * a.extraCostPctOfSde,
    },
  };
}

export function scenarios(input: CalculatorInputs) {
  return {
    CONSERVATIVE: calculate(applyAdjustment(input, SCENARIO_ADJUSTMENTS.CONSERVATIVE)),
    BASE: calculate(input),
    OPTIMISTIC: calculate(applyAdjustment(input, SCENARIO_ADJUSTMENTS.OPTIMISTIC)),
  };
}

// ───────────────────────── Sensitivity ─────────────────────────

export interface SensitivityRow {
  label: string;
  afterTaxCashToOwner: number | null;
  delta: number | null;
  meetsTarget: boolean | null;
  note?: string;
}

export function sensitivity(input: CalculatorInputs): SensitivityRow[] {
  const base = calculate(input);
  const row = (label: string, next: CalculatorInputs | null, note?: string): SensitivityRow => {
    if (!next) return { label, afterTaxCashToOwner: null, delta: null, meetsTarget: null, note };
    const r = calculate(next);
    return { label, afterTaxCashToOwner: r.afterTaxCashToOwner, delta: r.afterTaxCashToOwner - base.afterTaxCashToOwner, meetsTarget: r.meetsTarget, note };
  };
  const rows: SensitivityRow[] = [];
  const rev = input.deal.revenue;
  for (const pct of [0.1, 0.2, 0.3]) {
    const label = `Revenue −${pct * 100}%`;
    rows.push(
      rev
        ? row(label, { ...input, deal: { ...input.deal, sde: input.deal.sde - rev * pct * input.operating.contributionMarginPct } }, `Assumes ${Math.round(input.operating.contributionMarginPct * 100)}% contribution margin`)
        : row(label, null, "Revenue not disclosed"),
    );
  }
  const pay = input.deal.payroll;
  rows.push(
    pay
      ? row("Payroll +10%", { ...input, deal: { ...input.deal, sde: input.deal.sde - pay * 0.1 } })
      : row("Payroll +10%", null, "Payroll not disclosed"),
  );
  rows.push(
    row("Interest +2 pts", {
      ...input,
      financing: { ...input.financing, seniorLoan: bumpRate(input.financing.seniorLoan, 2), sellerNote: bumpRate(input.financing.sellerNote, 2) },
    }),
  );
  const shock = Math.round(input.deal.sde * 0.1);
  rows.push(
    row(`Unexpected expense ($${shock.toLocaleString("en-US")}/yr)`, {
      ...input,
      operating: { ...input.operating, additionalOperatingCosts: input.operating.additionalOperatingCosts + shock },
    }, "10% of SDE"),
  );
  return rows;
}
