import { describe, expect, it } from "vitest";
import { amortize, calculate, defaultFinancing, DEFAULT_OPERATING, DEFAULT_TARGETS, scenarios, sensitivity, validateFinancing, type CalculatorInputs } from "@/lib/finance/calculator";

const base = (over: Partial<CalculatorInputs> = {}): CalculatorInputs => ({
  deal: { purchasePrice: 1_000_000, sde: 400_000, revenue: 1_500_000, payroll: 300_000 },
  financing: { ...defaultFinancing("SBA_STYLE", 1_000_000) },
  operating: { ...DEFAULT_OPERATING },
  targets: { ...DEFAULT_TARGETS },
  ...over,
});

describe("amortize", () => {
  it("matches the standard mortgage reference ($100k, 6%, 30y ≈ $599.55/mo)", () => {
    expect(amortize(100_000, 6, 30).monthlyPayment).toBe(600);
  });
  it("handles zero interest", () => {
    const r = amortize(120_000, 0, 10);
    expect(r.monthlyPayment).toBe(1000);
    expect(r.firstYearInterest).toBe(0);
  });
  it("first-year interest is less than principal × rate (balance declines)", () => {
    const r = amortize(900_000, 10.5, 10);
    expect(r.firstYearInterest).toBeLessThan(900_000 * 0.105);
    expect(r.firstYearInterest).toBeGreaterThan(80_000);
  });
});

describe("calculate", () => {
  it("never treats SDE as take-home: subtracts debt service and taxes", () => {
    const r = calculate(base());
    expect(r.annualDebtService).toBeGreaterThan(140_000);
    expect(r.afterTaxCashToOwner).toBeLessThan(400_000 - r.annualDebtService);
    expect(r.afterTaxCashToOwner).toBe(r.preTaxCashToOwner - r.estimatedTaxes);
  });

  it("computes upfront investment = down + closing + working capital", () => {
    const r = calculate(base());
    expect(r.downPayment).toBe(100_000);
    expect(r.closingCosts).toBe(40_000);
    expect(r.workingCapitalReserve).toBe(50_000);
    expect(r.upfrontInvestment).toBe(190_000);
  });

  it("required SDE produces exactly the target after-tax income", () => {
    const r = calculate(base());
    const check = calculate(base({ deal: { purchasePrice: 1_000_000, sde: r.requiredSde } }));
    expect(Math.abs(check.afterTaxCashToOwner - DEFAULT_TARGETS.target)).toBeLessThanOrEqual(2);
  });

  it("semi-absentee deducts a manager salary and labels income as passive", () => {
    const owner = calculate(base());
    const semi = calculate(base({ operating: { ...DEFAULT_OPERATING, ownerRole: "SEMI_ABSENTEE", managerSalary: 80_000 } }));
    expect(semi.managerCost).toBe(80_000);
    expect(semi.preTaxCashToOwner).toBe(owner.preTaxCashToOwner - 80_000);
    expect(semi.incomeKind).toBe("PASSIVE_INVESTMENT_INCOME");
    expect(owner.incomeKind).toBe("OWNER_COMPENSATION_FOR_WORKING");
  });

  it("cash purchase has no debt service and null DSCR", () => {
    const r = calculate(base({ financing: defaultFinancing("CASH", 1_000_000) }));
    expect(r.annualDebtService).toBe(0);
    expect(r.dscr).toBeNull();
    expect(r.downPayment).toBe(1_000_000);
  });

  it("flags DSCR below threshold and negative cash flow", () => {
    const r = calculate(base({ deal: { purchasePrice: 1_000_000, sde: 120_000 } }));
    expect(r.dscrBelowThreshold).toBe(true);
    expect(r.preTaxCashToOwner).toBeLessThan(0);
    expect(r.estimatedTaxes).toBeGreaterThanOrEqual(0);
    expect(r.warnings.join(" ")).toMatch(/do not cover debt service/);
  });

  it("break-even SDE yields zero pre-tax cash", () => {
    const r = calculate(base());
    const be = calculate(base({ deal: { purchasePrice: 1_000_000, sde: r.breakEvenSde } }));
    expect(be.preTaxCashToOwner).toBe(0);
  });

  it("validates financing percentages", () => {
    expect(validateFinancing({ ...defaultFinancing("SBA_STYLE"), downPaymentPct: 0.2 })).toHaveLength(1);
    expect(validateFinancing(defaultFinancing("SBA_PLUS_SELLER"))).toHaveLength(0);
  });
});

describe("scenarios & sensitivity", () => {
  it("orders conservative < base < optimistic", () => {
    const s = scenarios(base());
    expect(s.CONSERVATIVE.afterTaxCashToOwner).toBeLessThan(s.BASE.afterTaxCashToOwner);
    expect(s.BASE.afterTaxCashToOwner).toBeLessThan(s.OPTIMISTIC.afterTaxCashToOwner);
  });
  it("reports revenue sensitivity as not computable when revenue is undisclosed", () => {
    const rows = sensitivity(base({ deal: { purchasePrice: 1_000_000, sde: 400_000, revenue: null, payroll: null } }));
    const rev = rows.find((r) => r.label === "Revenue −20%")!;
    expect(rev.afterTaxCashToOwner).toBeNull();
    expect(rev.note).toBe("Revenue not disclosed");
    expect(rows.find((r) => r.label === "Interest +2 pts")!.delta).toBeLessThan(0);
  });
  it("revenue decline reduces cash by revenue × decline × contribution margin (pre-tax)", () => {
    const b = calculate(base());
    const rows = sensitivity(base());
    const r10 = rows[0];
    expect(r10.delta).toBeLessThan(0);
    // pre-tax impact 1.5M × 10% × 50% = 75k; after tax ~ 75k × (1 − 25%)
    expect(Math.abs(r10.delta! + 75_000 * 0.75)).toBeLessThan(5);
    expect(b.afterTaxCashToOwner + r10.delta!).toBe(r10.afterTaxCashToOwner);
  });
});

describe("earnings definitions", () => {
  it("revenue never changes owner cash — only the stated earnings figure does", () => {
    const a = calculate(base({ deal: { purchasePrice: 1_000_000, sde: 400_000, revenue: 1_000_000 } }));
    const b = calculate(base({ deal: { purchasePrice: 1_000_000, sde: 400_000, revenue: 9_000_000 } }));
    expect(a.afterTaxCashToOwner).toBe(b.afterTaxCashToOwner);
  });
  it("EBITDA basis never subtracts a manager again (it's already paid in EBITDA)", () => {
    const semi = { ...DEFAULT_OPERATING, ownerRole: "SEMI_ABSENTEE" as const, managerSalary: 80_000 };
    const sde = calculate(base({ deal: { purchasePrice: 1_000_000, sde: 400_000 }, operating: semi }));
    const ebitda = calculate(base({ deal: { purchasePrice: 1_000_000, sde: 400_000, earningsBasis: "EBITDA" }, operating: semi }));
    expect(sde.managerCost).toBe(80_000);
    expect(ebitda.managerCost).toBe(0);
    expect(ebitda.earningsBasis).toBe("EBITDA");
    expect(ebitda.incomeKind).toBe("PASSIVE_INVESTMENT_INCOME");
    expect(ebitda.warnings.join(" ")).toMatch(/already pays a manager/);
  });
  it("walks earnings → debt service → tax → owner cash with exact arithmetic", () => {
    const r = calculate(base());
    expect(r.earningsBeforeDebtService).toBe(r.sde - r.managerCost - r.maintenanceCapex - r.additionalOperatingCosts);
    expect(r.preTaxCashToOwner).toBe(r.earningsBeforeDebtService - r.annualDebtService);
    expect(r.estimatedTaxes).toBe(Math.round(Math.max(0, r.earningsBeforeDebtService - (r.seniorLoan!.firstYearInterest)) * 0.25));
    expect(r.afterTaxCashToOwner).toBe(r.preTaxCashToOwner - r.estimatedTaxes);
    expect(r.monthlyAfterTaxCash).toBe(Math.round(r.afterTaxCashToOwner / 12));
  });
  it("principal repayment is not tax-deductible: taxes exceed tax on (earnings − total debt service)", () => {
    const r = calculate(base());
    expect(r.estimatedTaxes).toBeGreaterThan(Math.round((r.earningsBeforeDebtService - r.annualDebtService) * 0.25));
  });
});
