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
