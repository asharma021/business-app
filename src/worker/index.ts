/**
 * Background worker — run as a separate long-lived process (`npm run worker`).
 * Independent of any browser session. Handles:
 *   dispatch (every 10 min) → daily research → daily report + email
 *   manual "Run research now"
 *   single-opportunity research
 */
import PgBoss from "pg-boss";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { emailDeliveries, notifications, preferences, researchJobs } from "@/db/schema";
import { seedSources } from "@/db/seed-sources";
import { env } from "@/lib/env";
import { finishJob, jobLog, startJob } from "@/lib/jobs";
import { ensureQueues, QUEUES, type DailyReportData, type ResearchOpportunityData, type ResearchRunData } from "@/lib/queue";
import { researchOpportunityById, runResearchCycle } from "@/lib/research/pipeline";
import { deliverDailyEmail, generateDailyReport } from "@/lib/report/deliver";
import { dueActions } from "@/lib/schedule";

const e = env(); // fail fast on bad configuration

async function notifyFailure(userId: string | null, title: string, body: string, dedupeKey: string) {
  const targets = userId ? [userId] : (await db.select({ userId: preferences.userId }).from(preferences)).map((p) => p.userId);
  for (const u of targets) {
    await db.insert(notifications).values({ userId: u, kind: "failure", title, body: body.slice(0, 2000), dedupeKey }).onConflictDoNothing();
  }
}

async function handleResearchRun(data: ResearchRunData) {
  const jobId = await startJob(data.kind, data.idempotencyKey, data.triggeredBy);
  if (!jobId) return console.log(`research-run ${data.idempotencyKey}: already done or running, skipping`);
  try {
    await runResearchCycle(jobId);
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
    await finishJob(jobId, job.errors > 0 ? "PARTIAL" : "SUCCEEDED");
  } catch (err) {
    await jobLog(jobId, "error", `Research cycle crashed: ${(err as Error).message}`, { stack: (err as Error).stack });
    await finishJob(jobId, "FAILED");
    await notifyFailure(data.kind === "MANUAL_RESEARCH" ? data.triggeredBy : null, "Research run failed", (err as Error).message, `job-failed:${jobId}`);
    throw err; // let pg-boss retry
  }
}

async function handleDailyReport(data: DailyReportData, isFinalAttempt: boolean) {
  const [pref] = await db.select().from(preferences).where(eq(preferences.userId, data.userId));
  if (!pref) return;
  await generateDailyReport(data.userId, pref, data.reportDate);
  try {
    const status = await deliverDailyEmail(data.userId, pref, data.reportDate);
    console.log(`daily-report ${data.userId} ${data.reportDate}: ${status}`);
  } catch (err) {
    if (isFinalAttempt) await notifyFailure(data.userId, "Daily email failed", (err as Error).message, `email-failed:${data.reportDate}`);
    throw err;
  }
}

async function dispatch(boss: PgBoss) {
  const prefs = await db.select().from(preferences);
  const now = new Date();
  for (const pref of prefs) {
    const probe = dueActions({ now, timezone: pref.timezone, reportHour: pref.dailyReportHour, reportMinute: pref.dailyReportMinute, researchStatus: "NONE", reportSent: true });
    const key = `daily:${probe.date}`;
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.idempotencyKey, key));
    const researchStatus = !job ? "NONE" : job.status === "RUNNING" || job.status === "QUEUED" ? "RUNNING" : "DONE";
    const [delivery] = await db
      .select()
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.userId, pref.userId), eq(emailDeliveries.kind, "daily"), eq(emailDeliveries.reportDate, probe.date)));
    const reportSent = Boolean(delivery && (delivery.status === "SENT" || delivery.status === "SKIPPED"));
    const researchRunningMinutes = job?.startedAt ? (now.getTime() - job.startedAt.getTime()) / 60_000 : 0;
    const due = dueActions({ now, timezone: pref.timezone, reportHour: pref.dailyReportHour, reportMinute: pref.dailyReportMinute, researchStatus, researchRunningMinutes, reportSent });

    if (due.startResearch) {
      await boss.send(QUEUES.researchRun, { idempotencyKey: key, kind: "DAILY_RESEARCH", triggeredBy: "schedule" } satisfies ResearchRunData, {
        singletonKey: key,
        singletonHours: 6,
        retryLimit: 2,
        retryDelay: 300,
        expireInHours: 3,
      });
      console.log(`dispatch: queued research ${key}`);
    }
    if (due.sendReport && delivery?.status !== "FAILED") {
      await boss.send(QUEUES.dailyReport, { userId: pref.userId, reportDate: due.date } satisfies DailyReportData, {
        singletonKey: `report:${pref.userId}:${due.date}`,
        singletonHours: 1,
        retryLimit: 3,
        retryDelay: 120,
        retryBackoff: true,
      });
      console.log(`dispatch: queued report for ${pref.userId} ${due.date}`);
    }
  }
}

async function main() {
  await seedSources(db);
  const boss = new PgBoss({ connectionString: e.DATABASE_URL });
  boss.on("error", (err) => console.error("pg-boss error", err));
  await boss.start();
  await ensureQueues(boss);
  await boss.schedule(QUEUES.dispatch, "*/10 * * * *", {}, { tz: "UTC" });

  await boss.work(QUEUES.dispatch, async () => dispatch(boss));
  await boss.work<ResearchRunData>(QUEUES.researchRun, { batchSize: 1 }, async ([job]) => handleResearchRun(job.data));
  await boss.work<ResearchOpportunityData>(QUEUES.researchOpportunity, { batchSize: 1 }, async ([job]) => {
    await researchOpportunityById(job.data.opportunityId, null);
  });
  await boss.work<DailyReportData>(QUEUES.dailyReport, { batchSize: 1, includeMetadata: true }, async ([job]) =>
    handleDailyReport(job.data, job.retryCount >= job.retryLimit),
  );

  // Run one dispatch immediately on boot to catch up after downtime.
  await dispatch(boss).catch((err) => console.error("initial dispatch failed", err));
  console.log("Opportunity Radar worker started");

  const shutdown = async (sig: string) => {
    console.log(`${sig} received, draining…`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Worker failed to start", err);
  process.exit(1);
});
