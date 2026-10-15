/**
 * Postgres-backed job queue (pg-boss). Chosen over Redis/BullMQ because it
 * needs no extra infrastructure: jobs, retries and cron schedules live in the
 * same managed Postgres, survive restarts, and are transactional.
 */
import PgBoss from "pg-boss";

export const QUEUES = {
  dispatch: "dispatch",
  researchRun: "research-run",
  researchOpportunity: "research-opportunity",
  dailyReport: "daily-report",
} as const;

export interface ResearchRunData {
  idempotencyKey: string;
  kind: "DAILY_RESEARCH" | "MANUAL_RESEARCH";
  triggeredBy: string;
}
export interface ResearchOpportunityData {
  opportunityId: string;
  requestedBy: string;
}
export interface DailyReportData {
  userId: string;
  reportDate: string;
}

const g = globalThis as unknown as { radarBoss?: Promise<PgBoss> };

/** Send-only client for the web app (no maintenance or scheduling). */
export function getQueueClient(): Promise<PgBoss> {
  g.radarBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false, migrate: false });
    boss.on("error", (e) => console.error("pg-boss client error", e));
    await boss.start();
    return boss;
  })();
  return g.radarBoss;
}

export async function ensureQueues(boss: PgBoss) {
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name).catch((e: Error) => {
      if (!/already exists/i.test(e.message)) throw e;
    });
  }
}

export async function enqueueManualResearch(userId: string) {
  const boss = await getQueueClient();
  const key = `manual:${new Date().toISOString().slice(0, 16)}`; // at most one per minute
  return boss.send(QUEUES.researchRun, { idempotencyKey: key, kind: "MANUAL_RESEARCH", triggeredBy: userId } satisfies ResearchRunData, {
    retryLimit: 1,
    expireInHours: 2,
  });
}

export async function enqueueOpportunityResearch(opportunityId: string, userId: string) {
  const boss = await getQueueClient();
  return boss.send(QUEUES.researchOpportunity, { opportunityId, requestedBy: userId } satisfies ResearchOpportunityData, {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    singletonKey: `opp:${opportunityId}`,
    singletonMinutes: 5,
  });
}
