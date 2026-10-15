import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { financialScenarios, financialStatements, opportunities, opportunityScores, preferences, researchCitations, researchReports } from "@/db/schema";
import { scenarios } from "@/lib/finance/calculator";
import { calculatorInputsFor, weightsOf } from "@/lib/preferences";
import { score } from "@/lib/scoring";
import { ResearchReportSchema } from "@/lib/ai/schemas";

const PROV_RANK = { VERIFIED: 4, THIRD_PARTY: 3, SELLER_REPORTED: 2, AI_ESTIMATE: 1 } as const;
type Prov = keyof typeof PROV_RANK;

export async function bestProvenance(opportunityId: string): Promise<Prov | null> {
  const rows = await db.select({ p: financialStatements.provenance }).from(financialStatements).where(eq(financialStatements.opportunityId, opportunityId));
  return rows.reduce<Prov | null>((best, r) => (!best || PROV_RANK[r.p] > PROV_RANK[best] ? r.p : best), null);
}

/** Recompute scenarios and scores for one opportunity for every user. */
export async function scoreOpportunity(opportunityId: string) {
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
  if (!opp) return;
  const [report] = await db.select().from(researchReports).where(eq(researchReports.opportunityId, opportunityId)).orderBy(desc(researchReports.version)).limit(1);
  const citationCount = report
    ? Number((await db.select({ n: sql<number>`count(*)` }).from(researchCitations).where(eq(researchCitations.reportId, report.id)))[0].n)
    : 0;
  const parsedReport = report ? ResearchReportSchema.safeParse(report.sections) : null;
  const prov = await bestProvenance(opportunityId);
  const prefs = await db.select().from(preferences);

  for (const pref of prefs) {
    const inputs = calculatorInputsFor(pref, opp);
    const sc = inputs ? scenarios(inputs) : null;
    if (inputs && sc) {
      for (const kind of ["CONSERVATIVE", "BASE", "OPTIMISTIC"] as const) {
        await db
          .insert(financialScenarios)
          .values({ opportunityId, userId: pref.userId, kind, inputs: inputs as never, outputs: sc[kind] as never })
          .onConflictDoUpdate({
            target: [financialScenarios.opportunityId, financialScenarios.userId, financialScenarios.kind],
            set: { inputs: inputs as never, outputs: sc[kind] as never, computedAt: new Date() },
          });
      }
    } else {
      await db.delete(financialScenarios).where(and(eq(financialScenarios.opportunityId, opportunityId), eq(financialScenarios.userId, pref.userId)));
    }
    const r = score({
      opportunity: opp,
      bestFinancialProvenance: prov,
      base: sc?.BASE ?? null,
      conservative: sc?.CONSERVATIVE ?? null,
      report: parsedReport?.success ? parsedReport.data : null,
      citationCount,
      auditFlagCount: report?.auditFlags.length ?? 0,
      preferences: pref,
      weights: weightsOf(pref),
    });
    const values = {
      total: r.total,
      attractiveness: r.attractiveness,
      feasibility: r.feasibility,
      confidence: r.confidence,
      fit: r.fit,
      breakdown: { categories: r.breakdown, fitReasons: r.fitReasons },
      weights: r.weights,
      computedAt: new Date(),
    };
    await db
      .insert(opportunityScores)
      .values({ opportunityId, userId: pref.userId, ...values })
      .onConflictDoUpdate({ target: [opportunityScores.opportunityId, opportunityScores.userId], set: values });
  }
}

export async function scoreMany(ids?: string[]) {
  const rows = ids?.length
    ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.id, ids))
    : await db.select({ id: opportunities.id }).from(opportunities);
  for (const r of rows) await scoreOpportunity(r.id);
  return rows.length;
}
