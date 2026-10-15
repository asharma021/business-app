import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import { dailyReports, emailDeliveries, users, type Preference } from "@/db/schema";
import { env, features } from "@/lib/env";
import { buildDailyReport } from "./daily";
import { renderDailyEmail } from "./email";

export interface Mailer {
  send(msg: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<{ id: string }>;
}

export class ResendMailer implements Mailer {
  private client = new Resend(env().RESEND_API_KEY);
  async send(msg: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
    const { data, error } = await this.client.emails.send(
      { from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text },
      { idempotencyKey: msg.idempotencyKey },
    );
    if (error) throw new Error(`${error.name}: ${error.message}`);
    return { id: data!.id };
  }
}

let mailerOverride: Mailer | null = null;
export const setMailerForTests = (m: Mailer | null) => (mailerOverride = m);
const getMailer = (): Mailer | null => mailerOverride ?? (features.email() ? new ResendMailer() : null);

/** Build (or rebuild) and archive the report for a user/date. */
export async function generateDailyReport(userId: string, pref: Preference, reportDate: string) {
  const content = await buildDailyReport(userId, pref, reportDate);
  await db
    .insert(dailyReports)
    .values({ userId, reportDate, content })
    .onConflictDoUpdate({ target: [dailyReports.userId, dailyReports.reportDate], set: { content, createdAt: new Date() } });
  return content;
}

/**
 * Sends the daily email at most once per user per date.
 * The unique (user, kind, date) row is claimed before sending; a SENT row is never re-sent.
 */
export async function deliverDailyEmail(userId: string, pref: Preference, reportDate: string): Promise<"SENT" | "SKIPPED" | "ALREADY_SENT" | "FAILED"> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const to = pref.reportEmail ?? user?.email;
  const [report] = await db.select().from(dailyReports).where(and(eq(dailyReports.userId, userId), eq(dailyReports.reportDate, reportDate)));
  if (!report) throw new Error(`No report for ${reportDate}`);
  const { subject, html, text } = renderDailyEmail(report.content as never, env().APP_URL);

  await db.insert(emailDeliveries).values({ userId, kind: "daily", reportDate, to: to ?? "", subject }).onConflictDoNothing();
  const [row] = await db.select().from(emailDeliveries).where(and(eq(emailDeliveries.userId, userId), eq(emailDeliveries.kind, "daily"), eq(emailDeliveries.reportDate, reportDate)));
  if (row.status === "SENT") return "ALREADY_SENT";

  const mailer = getMailer();
  if (!pref.dailyEmailEnabled || !to || !mailer) {
    const reason = !pref.dailyEmailEnabled ? "Daily email disabled in settings" : !to ? "No recipient email" : "RESEND_API_KEY not configured";
    await db.update(emailDeliveries).set({ status: "SKIPPED", error: reason }).where(eq(emailDeliveries.id, row.id));
    return "SKIPPED";
  }
  try {
    const res = await mailer.send({ from: env().EMAIL_FROM, to, subject, html, text, idempotencyKey: `daily-${userId}-${reportDate}` });
    await db.update(emailDeliveries).set({ status: "SENT", providerId: res.id, sentAt: new Date(), attempts: row.attempts + 1, error: null, to }).where(eq(emailDeliveries.id, row.id));
    return "SENT";
  } catch (e) {
    await db.update(emailDeliveries).set({ status: "FAILED", error: (e as Error).message.slice(0, 2000), attempts: row.attempts + 1 }).where(eq(emailDeliveries.id, row.id));
    throw e;
  }
}

/**
 * Sends a short test email through the real provider and logs it.
 * Throws with the provider's message on failure (e.g. unverified domain).
 */
export async function sendTestEmail(userId: string | null, to: string): Promise<{ id: string }> {
  const mailer = getMailer();
  if (!mailer) throw new Error("RESEND_API_KEY is not set, so email can't be sent.");
  const stamp = new Date().toISOString();
  const subject = "Opportunity Radar — test email";
  const text = `This is a test email from Opportunity Radar, sent ${stamp}.\n\nIf you received it, daily reports can reach this address.\n\n${env().APP_URL}`;
  const html = `<p>This is a test email from <b>Opportunity Radar</b>, sent ${stamp}.</p><p>If you received it, daily reports can reach this address.</p><p><a href="${env().APP_URL}">${env().APP_URL}</a></p>`;
  const row = userId
    ? (await db.insert(emailDeliveries).values({ userId, kind: "test", reportDate: stamp, to, subject }).returning())[0]
    : null;
  try {
    const res = await mailer.send({ from: env().EMAIL_FROM, to, subject, html, text, idempotencyKey: `test-${crypto.randomUUID()}` });
    if (row) await db.update(emailDeliveries).set({ status: "SENT", providerId: res.id, sentAt: new Date(), attempts: 1 }).where(eq(emailDeliveries.id, row.id));
    return res;
  } catch (e) {
    if (row) await db.update(emailDeliveries).set({ status: "FAILED", error: (e as Error).message.slice(0, 2000), attempts: 1 }).where(eq(emailDeliveries.id, row.id));
    throw e;
  }
}

/** Builds today's report on demand and emails it as a separate "manual" send (doesn't consume the scheduled send). */
export async function sendReportNow(userId: string, pref: Preference, reportDate: string): Promise<{ id: string | null; status: "SENT" | "SKIPPED" }> {
  await generateDailyReport(userId, pref, reportDate);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const to = pref.reportEmail ?? user?.email;
  const mailer = getMailer();
  if (!to || !mailer) return { id: null, status: "SKIPPED" };
  const [report] = await db.select().from(dailyReports).where(and(eq(dailyReports.userId, userId), eq(dailyReports.reportDate, reportDate)));
  const { subject, html, text } = renderDailyEmail(report.content as never, env().APP_URL);
  const stamp = new Date().toISOString();
  const [row] = await db.insert(emailDeliveries).values({ userId, kind: "manual", reportDate: stamp, to, subject }).returning();
  try {
    const res = await mailer.send({ from: env().EMAIL_FROM, to, subject, html, text, idempotencyKey: `manual-${row.id}` });
    await db.update(emailDeliveries).set({ status: "SENT", providerId: res.id, sentAt: new Date(), attempts: 1 }).where(eq(emailDeliveries.id, row.id));
    return { id: res.id, status: "SENT" };
  } catch (e) {
    await db.update(emailDeliveries).set({ status: "FAILED", error: (e as Error).message.slice(0, 2000), attempts: 1 }).where(eq(emailDeliveries.id, row.id));
    throw e;
  }
}
