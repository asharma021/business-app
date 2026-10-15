import { eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { DEFAULT_FINANCING_DEFAULTS, financingDefaultsOf, getOrCreatePreference } from "@/lib/preferences";
import { PageHeader } from "@/components/ui";
import { CalculatorClient } from "./calculator-client";

export const metadata = { title: "Financial calculator" };

export default async function CalculatorPage({ searchParams }: { searchParams: Promise<{ opp?: string }> }) {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const { opp } = await searchParams;
  const [o] = opp ? await db.select().from(opportunities).where(eq(opportunities.id, opp)) : [];
  const fd = financingDefaultsOf(pref) ?? DEFAULT_FINANCING_DEFAULTS;
  return (
    <>
      <PageHeader
        title="Salary replacement calculator"
        description="Can this business replace your salary? Starts from reported earnings (SDE), then subtracts a manager if you won't run it, maintenance capex, debt service and estimated tax. Every input is an assumption you can change."
      />
      <CalculatorClient
        initial={{
          title: o?.title ?? null,
          purchasePrice: o?.askingPrice ?? 1_000_000,
          sde: o?.cashFlow ?? o?.ebitda ?? 350_000,
          earningsBasis: o && o.cashFlow == null && o.ebitda != null ? "EBITDA" : "SDE",
          revenue: o?.revenue ?? null,
          financing: fd,
          targets: { target: pref.targetOwnerIncome, minimum: pref.minOwnerIncome, stretch: pref.stretchOwnerIncome },
          fromOpportunity: Boolean(o),
          missing: o ? [o.askingPrice == null && "asking price", o.cashFlow == null && o.ebitda == null && "earnings (SDE or EBITDA)"].filter(Boolean) as string[] : [],
        }}
      />
    </>
  );
}
