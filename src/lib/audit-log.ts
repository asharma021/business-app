import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function audit(userId: string | null, action: string, entity?: string, entityId?: string, meta?: unknown) {
  await db.insert(auditLogs).values({ userId, action, entity: entity ?? null, entityId: entityId ?? null, meta: meta === undefined ? null : (meta as object) });
}

export class RateLimitError extends Error {}

/**
 * Per-user rate limit backed by the audit log (no Redis needed).
 * Records the action when allowed; throws RateLimitError otherwise.
 */
export async function rateLimited(userId: string, action: string, max: number, windowMinutes: number, entityId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), eq(auditLogs.action, action), gte(auditLogs.at, new Date(Date.now() - windowMinutes * 60_000))));
  if (Number(n) >= max) throw new RateLimitError(`Limit reached: ${max} per ${windowMinutes} minutes. Try again later.`);
  await audit(userId, action, undefined, entityId);
}
