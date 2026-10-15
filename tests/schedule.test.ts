import { describe, expect, it } from "vitest";
import { dueActions } from "@/lib/schedule";

const at = (iso: string, over = {}) =>
  dueActions({ now: new Date(iso), timezone: "America/Chicago", reportHour: 7, reportMinute: 0, researchStatus: "NONE", reportSent: false, ...over });

describe("dispatcher schedule (7:00 AM Central, CDT = UTC−5)", () => {
  it("does nothing before research lead time", () => {
    expect(at("2026-10-16T10:50:00Z")).toMatchObject({ date: "2026-10-16", startResearch: false, sendReport: false }); // 5:50 CT
  });
  it("starts research one hour before the report", () => {
    expect(at("2026-10-16T11:00:00Z").startResearch).toBe(true); // 6:00 CT
  });
  it("waits for research before sending, then sends", () => {
    expect(at("2026-10-16T12:00:00Z", { researchStatus: "RUNNING" }).sendReport).toBe(false);
    expect(at("2026-10-16T12:00:00Z", { researchStatus: "DONE" }).sendReport).toBe(true);
  });
  it("sends anyway once a run has been going 90 minutes, so a stuck run can't block the email", () => {
    expect(at("2026-10-16T13:30:00Z", { researchStatus: "RUNNING", researchRunningMinutes: 30 }).sendReport).toBe(false);
    expect(at("2026-10-16T13:30:00Z", { researchStatus: "RUNNING", researchRunningMinutes: 95 }).sendReport).toBe(true);
  });
  it("after downtime, starts research first and holds the report until it finishes", () => {
    const r = at("2026-10-16T20:00:00Z", { researchStatus: "NONE" });
    expect(r.startResearch).toBe(true);
    expect(r.sendReport).toBe(false);
  });
  it("catches up later the same day after downtime but never re-sends", () => {
    expect(at("2026-10-16T20:00:00Z", { researchStatus: "DONE" }).sendReport).toBe(true);
    expect(at("2026-10-16T20:00:00Z", { researchStatus: "DONE", reportSent: true }).sendReport).toBe(false);
  });
  it("uses the local date across UTC midnight", () => {
    expect(at("2026-10-17T03:00:00Z").date).toBe("2026-10-16"); // 10pm CT
  });
});

describe("7:00 AM America/Chicago across daylight saving time", () => {
  const due = (iso: string) => dueActions({ now: new Date(iso), timezone: "America/Chicago", reportHour: 7, reportMinute: 0, researchStatus: "DONE", reportSent: false });
  it("winter (CST, UTC−6): 7:00 local is 13:00 UTC", () => {
    expect(due("2026-01-15T12:59:00Z").sendReport).toBe(false);
    expect(due("2026-01-15T13:00:00Z").sendReport).toBe(true);
  });
  it("summer (CDT, UTC−5): 7:00 local is 12:00 UTC", () => {
    expect(due("2026-07-15T11:59:00Z").sendReport).toBe(false);
    expect(due("2026-07-15T12:00:00Z").sendReport).toBe(true);
  });
  it("spring-forward day (Sun 2026-03-08): 7:00 CDT = 12:00 UTC", () => {
    expect(due("2026-03-08T11:59:00Z").sendReport).toBe(false);
    expect(due("2026-03-08T12:00:00Z").sendReport).toBe(true);
    expect(due("2026-03-08T12:00:00Z").date).toBe("2026-03-08");
  });
  it("fall-back day (Sun 2026-11-01): 7:00 CST = 13:00 UTC", () => {
    expect(due("2026-11-01T12:59:00Z").sendReport).toBe(false);
    expect(due("2026-11-01T13:00:00Z").sendReport).toBe(true);
  });
  it("research starts at 6:00 local in both seasons", () => {
    const start = (iso: string) => dueActions({ now: new Date(iso), timezone: "America/Chicago", reportHour: 7, reportMinute: 0, researchStatus: "NONE", reportSent: false }).startResearch;
    expect(start("2026-01-15T11:59:00Z")).toBe(false);
    expect(start("2026-01-15T12:00:00Z")).toBe(true); // 6:00 CST
    expect(start("2026-07-15T10:59:00Z")).toBe(false);
    expect(start("2026-07-15T11:00:00Z")).toBe(true); // 6:00 CDT
  });
});
