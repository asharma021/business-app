import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { researchJobLogs, researchJobs } from "@/db/schema";
import { costUsd, type Usage } from "@/lib/ai/provider";

type JobKind = (typeof researchJobs.$inferSelect)["kind"];
type JobStatus = (typeof researchJobs.$inferSelect)["status"];

/**
 * Idempotent job start. Returns the job id to run, or null if a job with the
 * same key already succeeded or is running (e.g. a duplicate cron fire).
 * A previously FAILED/PARTIAL job with the same key is re-run.
 */
export async function startJob(kind: JobKind, idempotencyKey: string, triggeredBy: string): Promise<string | null> {
  const inserted = await db
    .insert(researchJobs)
    .values({ kind, idempotencyKey, triggeredBy, status: "RUNNING", startedAt: new Date() })
    .onConflictDoNothing({ target: researchJobs.idempotencyKey })
    .returning({ id: researchJobs.id });
  if (inserted[0]) return inserted[0].id;

  const [existing] = await db.select().from(researchJobs).where(eq(researchJobs.idempotencyKey, idempotencyKey));
  if (!existing) return null;
  // A RUNNING job older than 2h is presumed dead (worker crash) and may be retried.
  const stale = existing.status === "RUNNING" && existing.startedAt && Date.now() - existing.startedAt.getTime() > 2 * 3600_000;
  if (existing.status === "FAILED" || existing.status === "PARTIAL" || stale) {
    const [row] = await db
      .update(researchJobs)
      .set({ status: "RUNNING", startedAt: new Date(), finishedAt: null })
      .where(and(eq(researchJobs.id, existing.id), eq(researchJobs.status, existing.status)))
      .returning({ id: researchJobs.id });
    return row?.id ?? null;
  }
  return null;
}

export async function jobLog(jobId: string | null | undefined, level: "info" | "warn" | "error", message: string, data?: unknown) {
  const line = `[job ${jobId ?? "-"}] ${level.toUpperCase()} ${message}`;
  if (level === "error") console.error(line, data ?? "");
  else console.log(line);
  if (!jobId) return;
  await db.insert(researchJobLogs).values({ jobId, level, message: message.slice(0, 4000), data: data === undefined ? null : JSON.parse(JSON.stringify(data)) });
}

export async function addJobUsage(jobId: string | null | undefined, u: Usage) {
  if (!jobId) return;
  const c = costUsd(u);
  await db
    .update(researchJobs)
    .set({
      inputTokens: sql`${researchJobs.inputTokens} + ${u.inputTokens}`,
      outputTokens: sql`${researchJobs.outputTokens} + ${u.outputTokens}`,
      webSearches: sql`${researchJobs.webSearches} + ${u.webSearches}`,
      ...(c !== null ? { costUsd: sql`coalesce(${researchJobs.costUsd}, 0) + ${c.toFixed(4)}` } : {}),
    })
    .where(eq(researchJobs.id, jobId));
}

export type JobCounters = Partial<Pick<typeof researchJobs.$inferSelect, "sourcesAttempted" | "sourcesSucceeded" | "discovered" | "updated" | "researched" | "errors">>;

export async function bumpJob(jobId: string | null | undefined, c: JobCounters) {
  if (!jobId) return;
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (v) set[k] = sql`${researchJobs[k as keyof JobCounters]} + ${v}`;
  if (Object.keys(set).length) await db.update(researchJobs).set(set).where(eq(researchJobs.id, jobId));
}

export async function finishJob(jobId: string, status: JobStatus) {
  await db.update(researchJobs).set({ status, finishedAt: new Date() }).where(eq(researchJobs.id, jobId));
}

/** AI spend recorded in the last 24h (null if prices aren't configured). */
export async function aiSpendLast24h(): Promise<number | null> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${researchJobs.costUsd})` })
    .from(researchJobs)
    .where(gte(researchJobs.createdAt, new Date(Date.now() - 86_400_000)));
  return row?.total === null || row?.total === undefined ? null : Number(row.total);
}
