import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { preferences, type Preference } from "@/db/schema";
import { DEFAULT_OPERATING, FINANCING_PRESETS, type CalculatorInputs, type FinancingInputs, type OperatingInputs } from "@/lib/finance/calculator";
import { DEFAULT_WEIGHTS, normalizeWeights, type Weights } from "@/lib/scoring";

const Loan = z.object({ pct: z.number().min(0).max(1), ratePct: z.number().min(0).max(40), termYears: z.number().positive().max(30) }).nullable();

export const FinancingDefaultsSchema = z.object({
  structure: z.enum(["SBA_STYLE", "SBA_PLUS_SELLER", "CONVENTIONAL", "SELLER", "CASH", "CUSTOM"]),
  downPaymentPct: z.number().min(0).max(1),
  seniorLoan: Loan,
  sellerNote: Loan,
  closingCostsPct: z.number().min(0).max(0.2),
  workingCapitalPctOfPrice: z.number().min(0).max(0.5),
  operating: z.object({
    ownerRole: z.enum(["OWNER_OPERATED", "SEMI_ABSENTEE"]),
    managerSalary: z.number().min(0),
    maintenanceCapex: z.number().min(0),
    additionalOperatingCosts: z.number().min(0),
    effectiveTaxRatePct: z.number().min(0).max(60),
    contributionMarginPct: z.number().min(0).max(1),
    dscrThreshold: z.number().min(0).max(5),
  }),
});
export type FinancingDefaults = z.infer<typeof FinancingDefaultsSchema>;

export const DEFAULT_FINANCING_DEFAULTS: FinancingDefaults = {
  ...FINANCING_PRESETS.SBA_STYLE,
  workingCapitalPctOfPrice: 0.05,
  operating: DEFAULT_OPERATING,
};

export function financingDefaultsOf(p: Pick<Preference, "financingDefaults">): FinancingDefaults {
  const parsed = FinancingDefaultsSchema.safeParse(p.financingDefaults);
  return parsed.success ? parsed.data : DEFAULT_FINANCING_DEFAULTS;
}

export function weightsOf(p: Pick<Preference, "scoringWeights">): Weights {
  return normalizeWeights((p.scoringWeights as Partial<Weights> | null) ?? DEFAULT_WEIGHTS);
}

/** Build calculator inputs for an opportunity using the user's saved assumptions. */
export function calculatorInputsFor(
  pref: Preference,
  deal: { askingPrice: number | null; cashFlow: number | null; revenue: number | null; payroll?: number | null },
): CalculatorInputs | null {
  if (deal.askingPrice == null || deal.cashFlow == null) return null;
  const d = financingDefaultsOf(pref);
  const financing: FinancingInputs = {
    structure: d.structure,
    downPaymentPct: d.downPaymentPct,
    seniorLoan: d.seniorLoan,
    sellerNote: d.sellerNote,
    closingCostsPct: d.closingCostsPct,
    workingCapitalReserve: Math.round(deal.askingPrice * d.workingCapitalPctOfPrice),
  };
  const operating: OperatingInputs = d.operating;
  return {
    deal: { purchasePrice: deal.askingPrice, sde: deal.cashFlow, revenue: deal.revenue, payroll: deal.payroll ?? null },
    financing,
    operating,
    targets: { target: pref.targetOwnerIncome, minimum: pref.minOwnerIncome, stretch: pref.stretchOwnerIncome },
  };
}

export async function getOrCreatePreference(userId: string, email?: string | null): Promise<Preference> {
  const [existing] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(preferences)
    .values({ userId, scoringWeights: DEFAULT_WEIGHTS, financingDefaults: DEFAULT_FINANCING_DEFAULTS, reportEmail: email ?? null })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  return again;
}
