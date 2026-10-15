/**
 * Pure scheduling logic for the dispatcher (unit-tested).
 * The dispatcher runs every 10 minutes; this decides what is due. Running late
 * (worker was down) still catches up the same day, and nothing runs twice
 * because research jobs and email deliveries are idempotent in the database.
 */
import { localDate } from "@/lib/format";

export const RESEARCH_LEAD_MINUTES = 60; // research starts this long before the report time
export const REPORT_WAIT_MAX_MINUTES = 90; // send even if a research run has been going this long

export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

export interface DueInput {
  now: Date;
  timezone: string;
  reportHour: number;
  reportMinute: number;
  researchStatus: "NONE" | "RUNNING" | "DONE";
  /** minutes since today's research run started (RUNNING only) */
  researchRunningMinutes?: number;
  reportSent: boolean;
}
export interface DueResult {
  date: string;
  startResearch: boolean;
  sendReport: boolean;
}

export function dueActions(i: DueInput): DueResult {
  const date = localDate(i.now, i.timezone);
  const nowMin = localMinutes(i.now, i.timezone);
  const reportMin = i.reportHour * 60 + i.reportMinute;
  const researchMin = Math.max(0, reportMin - RESEARCH_LEAD_MINUTES);
  const startResearch = i.researchStatus === "NONE" && nowMin >= researchMin;
  // Never send before today's research has at least been attempted; don't let a stuck run block the email.
  const researchSettled = i.researchStatus === "DONE" || (i.researchStatus === "RUNNING" && (i.researchRunningMinutes ?? 0) >= REPORT_WAIT_MAX_MINUTES);
  const sendReport = !i.reportSent && nowMin >= reportMin && researchSettled;
  return { date, startResearch, sendReport };
}
