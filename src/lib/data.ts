/** Read models for pages. All queries are scoped to the signed-in user where relevant. */
import { and, desc, eq, gte, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  dataRefreshes,
  financialScenarios,
  financialStatements,
  listings,
  notes,
  opportunities,
  opportunityScores,
  researchCitations,
  researchReports,
  sources,
  userFeedback,
  watchlistItems,
} from "@/db/schema";
import type { CalculatorResult } from "@/lib/finance/calculator";

export const OpportunityFilters = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(["ACQUISITION", "FRANCHISE", "EMERGING"]).optional(),
  state: z.string().length(2).optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  minCashFlow: z.coerce.number().int().nonnegative().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  meetsTarget: z.enum(["1"]).optional(),
  sellerFinancing: z.enum(["1"]).optional(),
  research: z.enum(["NEW", "QUEUED", "RESEARCHING", "RESEARCHED", "NEEDS_INFO", "FAILED"]).optional(),
  saved: z.enum(["1"]).optional(),
  archived: z.enum(["1"]).optional(),
  sort: z.enum(["score", "newest", "price", "cashflow", "income"]).default("score"),
});
export type OpportunityFilters = z.infer<typeof OpportunityFilters>;

export function parseFilters(sp: Record<string, string | string[] | undefined>): OpportunityFilters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== "" && v !== undefined));
  const r = OpportunityFilters.safeParse(flat);
  return r.success ? r.data : OpportunityFilters.parse({});
}

export interface OpportunityRow {
  id: string;
  title: string;
  type: string;
  industry: string | null;
  city: string | null;
  state: string | null;
  metro: string | null;
  askingPrice: number | null;
  revenue: number | null;
  cashFlow: number | null;
  sellerFinancing: boolean | null;
  listingStatus: string;
  researchStatus: string;
  pipelineStatus: string;
  firstDiscoveredAt: Date;
  lastVerifiedAt: Date | null;
  score: number | null;
  confidence: number | null;
  base: CalculatorResult | null;
  saved: boolean;
  recommendation: string | null;
}

const latestRec = sql<string | null>`(select r.recommendation from research_report r where r.opportunity_id = ${opportunities.id} order by r.version desc limit 1)`;

export async function listOpportunities(userId: string, f: OpportunityFilters, limit = 100, ids?: string[]): Promise<OpportunityRow[]> {
  const where: SQL[] = [];
  if (ids) where.push(inArray(opportunities.id, ids.length ? ids : ["-"]));
  if (!f.archived) where.push(ne(opportunities.listingStatus, "ARCHIVED"));
  if (f.type) where.push(eq(opportunities.type, f.type));
  if (f.state) where.push(eq(opportunities.state, f.state.toUpperCase()));
  if (f.maxPrice) where.push(sql`${opportunities.askingPrice} <= ${f.maxPrice}`);
  if (f.minCashFlow) where.push(sql`${opportunities.cashFlow} >= ${f.minCashFlow}`);
  if (f.minScore) where.push(sql`${opportunityScores.total} >= ${f.minScore}`);
  if (f.sellerFinancing) where.push(eq(opportunities.sellerFinancing, true));
  if (f.research) where.push(eq(opportunities.researchStatus, f.research));
  if (f.saved) where.push(isNotNull(watchlistItems.id));
  if (f.meetsTarget) where.push(sql`(${financialScenarios.outputs}->>'meetsTarget')::boolean = true`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(opportunities.title, like), ilike(opportunities.industry, like), ilike(opportunities.city, like), ilike(opportunities.description, like))!);
  }
  const income = sql`(${financialScenarios.outputs}->>'afterTaxCashToOwner')::int`;
  const order = {
    score: [sql`${opportunityScores.total} desc nulls last`, desc(opportunities.firstDiscoveredAt)],
    newest: [desc(opportunities.firstDiscoveredAt)],
    price: [sql`${opportunities.askingPrice} asc nulls last`],
    cashflow: [sql`${opportunities.cashFlow} desc nulls last`],
    income: [sql`${income} desc nulls last`],
  }[f.sort];

  const rows = await db
    .select({
      o: opportunities,
      score: opportunityScores.total,
      confidence: opportunityScores.confidence,
      base: financialScenarios.outputs,
      savedId: watchlistItems.id,
      recommendation: latestRec,
    })
    .from(opportunities)
    .leftJoin(opportunityScores, and(eq(opportunityScores.opportunityId, opportunities.id), eq(opportunityScores.userId, userId)))
    .leftJoin(financialScenarios, and(eq(financialScenarios.opportunityId, opportunities.id), eq(financialScenarios.userId, userId), eq(financialScenarios.kind, "BASE")))
    .leftJoin(watchlistItems, and(eq(watchlistItems.opportunityId, opportunities.id), eq(watchlistItems.userId, userId)))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(limit);

  return rows.map((r) => ({
    ...r.o,
    score: r.score,
    confidence: r.confidence,
    base: (r.base as unknown as CalculatorResult) ?? null,
    saved: Boolean(r.savedId),
    recommendation: r.recommendation,
  }));
}

export async function getOpportunityDetail(id: string, userId: string) {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, id));
  if (!o) return null;
  const [ls, stmts, reps, [score], scen, [saved], fb, ns, history] = await Promise.all([
    db
      .select({ l: listings, sourceName: sources.name, sourceKey: sources.key, reliability: sources.reliability })
      .from(listings)
      .innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(eq(listings.opportunityId, id))
      .orderBy(desc(listings.lastSeenAt)),
    db.select().from(financialStatements).where(eq(financialStatements.opportunityId, id)).orderBy(desc(financialStatements.createdAt)),
    db.select().from(researchReports).where(eq(researchReports.opportunityId, id)).orderBy(desc(researchReports.version)),
    db.select().from(opportunityScores).where(and(eq(opportunityScores.opportunityId, id), eq(opportunityScores.userId, userId))),
    db.select().from(financialScenarios).where(and(eq(financialScenarios.opportunityId, id), eq(financialScenarios.userId, userId))),
    db.select().from(watchlistItems).where(and(eq(watchlistItems.opportunityId, id), eq(watchlistItems.userId, userId))),
    db.select().from(userFeedback).where(and(eq(userFeedback.opportunityId, id), eq(userFeedback.userId, userId))),
    db.select().from(notes).where(and(eq(notes.opportunityId, id), eq(notes.userId, userId))).orderBy(desc(notes.createdAt)),
    db.select().from(dataRefreshes).where(eq(dataRefreshes.opportunityId, id)).orderBy(desc(dataRefreshes.observedAt)).limit(50),
  ]);
  const latest = reps[0] ?? null;
  const citations = latest ? await db.select().from(researchCitations).where(eq(researchCitations.reportId, latest.id)) : [];
  return {
    o,
    listings: ls,
    statements: stmts,
    reports: reps,
    latest,
    citations,
    score: score ?? null,
    scenarios: Object.fromEntries(scen.map((s) => [s.kind, s])) as Partial<Record<"CONSERVATIVE" | "BASE" | "OPTIMISTIC", (typeof scen)[number]>>,
    saved: Boolean(saved),
    feedback: fb.map((f) => f.kind),
    notes: ns,
    history,
  };
}

export async function overviewData(userId: string) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [newToday, top, meeting, cuts, needsInfo, recentResearch, saved] = await Promise.all([
    listOpportunities(userId, OpportunityFilters.parse({ sort: "newest" }), 50).then((r) => r.filter((o) => o.firstDiscoveredAt >= dayAgo)),
    listOpportunities(userId, OpportunityFilters.parse({ sort: "score" }), 8),
    listOpportunities(userId, OpportunityFilters.parse({ meetsTarget: "1", sort: "score" }), 6),
    db
      .select({ r: dataRefreshes, title: opportunities.title })
      .from(dataRefreshes)
      .innerJoin(opportunities, eq(opportunities.id, dataRefreshes.opportunityId))
      .where(and(eq(dataRefreshes.field, "askingPrice"), gte(dataRefreshes.observedAt, new Date(Date.now() - 30 * 86_400_000))))
      .orderBy(desc(dataRefreshes.observedAt))
      .limit(20),
    listOpportunities(userId, OpportunityFilters.parse({ research: "NEEDS_INFO", sort: "newest" }), 6),
    db
      .select({ id: researchReports.id, opportunityId: researchReports.opportunityId, title: opportunities.title, rec: researchReports.recommendation, at: researchReports.createdAt })
      .from(researchReports)
      .innerJoin(opportunities, eq(opportunities.id, researchReports.opportunityId))
      .orderBy(desc(researchReports.createdAt))
      .limit(6),
    listOpportunities(userId, OpportunityFilters.parse({ saved: "1", sort: "score" }), 6),
  ]);
  return {
    newToday,
    top,
    meeting,
    priceCuts: cuts.filter((c) => c.r.oldValue && c.r.newValue && Number(c.r.newValue) < Number(c.r.oldValue)),
    needsInfo,
    recentResearch,
    saved,
  };
}

export async function opportunitiesByIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await listOpportunities(userId, OpportunityFilters.parse({ archived: "1" }), ids.length, ids);
  return ids.map((id) => rows.find((o) => o.id === id)).filter((o): o is OpportunityRow => Boolean(o));
}

