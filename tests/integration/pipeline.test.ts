import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dataRefreshes, dailyReports, financialStatements, emailDeliveries, financialScenarios, listings, opportunities, opportunityScores, researchJobs, users, watchlistItems } from "@/db/schema";
import { ingestCandidate, recordEvidence, type Candidate } from "@/lib/ingest";
import { getOrCreatePreference } from "@/lib/preferences";
import { scoreOpportunity } from "@/lib/research/scoring-service";
import { startJob, finishJob } from "@/lib/jobs";
import { generateDailyReport, deliverDailyEmail, setMailerForTests } from "@/lib/report/deliver";

const listing = (over: Partial<Candidate> = {}): Candidate => ({
  type: "ACQUISITION", title: "Commercial Cleaning Company with Recurring Contracts", industry: "Janitorial services",
  city: "Plano", state: "TX", askingPrice: 1_200_000, revenue: 1_800_000, cashFlow: 450_000, sellerFinancing: true, listingStatus: "ACTIVE", ...over,
});

async function makeUser() {
  const [u] = await db.insert(users).values({ email: "owner@example.com" }).returning();
  const pref = await getOrCreatePreference(u.id, u.email);
  return { user: u, pref };
}

describe("ingest + dedupe", () => {
  it("creates an opportunity, infers DFW metro, and tracks missing fields", async () => {
    const ev = await recordEvidence("manual_url", { url: "https://broker-a.example/l/1", text: "listing text" });
    const r = await ingestCandidate({ candidate: listing({ revenue: null }), sourceKey: "manual_url", url: "https://broker-a.example/l/1", sourceRecordId: ev.sourceRecordId, provenance: "SELLER_REPORTED" });
    expect(r.created).toBe(true);
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, r.opportunityId));
    expect(o.metro).toBe("Dallas-Fort Worth");
    expect(o.missingFields).toContain("revenue");
    expect(o.revenue).toBeNull();
    expect(o.researchStatus).toBe("QUEUED");
  });

  it("merges the same business from a second site and records the price reduction", async () => {
    const a = await ingestCandidate({ candidate: listing(), sourceKey: "manual_url", url: "https://broker-a.example/l/1", provenance: "SELLER_REPORTED" });
    const b = await ingestCandidate({
      candidate: listing({ title: "Plano Commercial Cleaning - Recurring Contracts", askingPrice: 1_100_000, cashFlow: 455_000, revenue: null }),
      sourceKey: "document", url: "document:abc", provenance: "SELLER_REPORTED",
    });
    expect(b.created).toBe(false);
    expect(b.opportunityId).toBe(a.opportunityId);
    expect((await db.select().from(opportunities)).length).toBe(1);
    expect((await db.select().from(listings)).length).toBe(2);
    const [o] = await db.select().from(opportunities);
    expect(o.askingPrice).toBe(1_100_000);
    expect(o.revenue).toBe(1_800_000); // not erased by a source that omitted it
    const changes = await db.select().from(dataRefreshes).where(eq(dataRefreshes.field, "askingPrice"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: "1200000", newValue: "1100000" });
    // Re-seeing identical figures must not duplicate the statement.
    await ingestCandidate({ candidate: listing(), sourceKey: "manual_url", url: "https://broker-a.example/l/1", provenance: "SELLER_REPORTED" });
    expect((await db.select().from(financialStatements)).length).toBe(2);
  });

  it("does not merge different businesses", async () => {
    await ingestCandidate({ candidate: listing(), sourceKey: "manual_url", url: "https://a.example/1", provenance: "SELLER_REPORTED" });
    await ingestCandidate({ candidate: listing({ title: "HVAC Service Company", industry: "HVAC", cashFlow: 300_000 }), sourceKey: "manual_url", url: "https://a.example/2", provenance: "SELLER_REPORTED" });
    expect((await db.select().from(opportunities)).length).toBe(2);
  });
});

describe("scoring service", () => {
  it("stores three scenarios and a score per user; undisclosed financials give no scenarios", async () => {
    const { user } = await makeUser();
    const full = await ingestCandidate({ candidate: listing(), sourceKey: "manual_url", url: "https://a.example/1", provenance: "SELLER_REPORTED" });
    const partial = await ingestCandidate({ candidate: listing({ title: "Pest control route", cashFlow: null, revenue: null }), sourceKey: "manual_url", url: "https://a.example/2", provenance: "SELLER_REPORTED" });
    await scoreOpportunity(full.opportunityId);
    await scoreOpportunity(partial.opportunityId);
    expect(await db.select().from(financialScenarios).where(eq(financialScenarios.opportunityId, full.opportunityId))).toHaveLength(3);
    expect(await db.select().from(financialScenarios).where(eq(financialScenarios.opportunityId, partial.opportunityId))).toHaveLength(0);
    const scores = await db.select().from(opportunityScores).where(eq(opportunityScores.userId, user.id));
    const s1 = scores.find((s) => s.opportunityId === full.opportunityId)!;
    const s2 = scores.find((s) => s.opportunityId === partial.opportunityId)!;
    expect(s1.total).toBeGreaterThan(s2.total);
    expect(s2.feasibility).toBe(0);
  });
});

describe("jobs", () => {
  it("is idempotent per key and allows re-running failed jobs", async () => {
    const a = await startJob("DAILY_RESEARCH", "daily:2026-10-16", "schedule");
    expect(a).toBeTruthy();
    expect(await startJob("DAILY_RESEARCH", "daily:2026-10-16", "schedule")).toBeNull();
    await finishJob(a!, "FAILED");
    expect(await startJob("DAILY_RESEARCH", "daily:2026-10-16", "schedule")).toBe(a);
    await finishJob(a!, "SUCCEEDED");
    expect(await startJob("DAILY_RESEARCH", "daily:2026-10-16", "schedule")).toBeNull();
    expect(await db.select().from(researchJobs)).toHaveLength(1);
  });
});

describe("daily report + email", () => {
  it("builds an honest report and sends exactly one email per day", async () => {
    const { user, pref } = await makeUser();
    const r = await ingestCandidate({ candidate: listing(), sourceKey: "manual_url", url: "https://broker-a.example/l/1", provenance: "SELLER_REPORTED" });
    await scoreOpportunity(r.opportunityId);
    await db.insert(watchlistItems).values({ userId: user.id, opportunityId: r.opportunityId });
    await ingestCandidate({ candidate: listing({ askingPrice: 1_050_000 }), sourceKey: "manual_url", url: "https://broker-a.example/l/1", provenance: "SELLER_REPORTED" });
    await scoreOpportunity(r.opportunityId);

    const content = await generateDailyReport(user.id, pref, "2026-10-16");
    expect(content.newOpportunities.map((i) => i.id)).toContain(r.opportunityId);
    expect(content.priceReductions[0].note).toMatch(/Price cut/);
    expect(content.watchlistAlerts).toHaveLength(1);
    expect(content.newOpportunities[0].sourceUrl).toBe("https://broker-a.example/l/1");
    expect(await db.select().from(dailyReports)).toHaveLength(1);

    const sent: string[] = [];
    setMailerForTests({ send: async (m) => (sent.push(m.subject), { id: `msg_${sent.length}` }) });
    expect(await deliverDailyEmail(user.id, pref, "2026-10-16")).toBe("SENT");
    expect(await deliverDailyEmail(user.id, pref, "2026-10-16")).toBe("ALREADY_SENT");
    expect(sent).toEqual(["Opportunity Radar AI — Daily Business Investment Intelligence"]);
    const [d] = await db.select().from(emailDeliveries);
    expect(d).toMatchObject({ status: "SENT", providerId: "msg_1", to: "owner@example.com" });
    setMailerForTests(null);
  });

  it("says so when there is nothing compelling, instead of inventing results", async () => {
    const { user, pref } = await makeUser();
    const content = await generateDailyReport(user.id, pref, "2026-10-16");
    expect(content.hasCompellingOpportunities).toBe(false);
    expect(content.executiveSummary.join(" ")).toMatch(/No compelling opportunities found today/);
    expect(content.newOpportunities).toHaveLength(0);
  });

  it("records a failed delivery and retries cleanly", async () => {
    const { user, pref } = await makeUser();
    await generateDailyReport(user.id, pref, "2026-10-17");
    setMailerForTests({ send: async () => { throw new Error("provider down"); } });
    await expect(deliverDailyEmail(user.id, pref, "2026-10-17")).rejects.toThrow("provider down");
    setMailerForTests({ send: async () => ({ id: "ok" }) });
    expect(await deliverDailyEmail(user.id, pref, "2026-10-17")).toBe("SENT");
    const [d] = await db.select().from(emailDeliveries);
    expect(d.attempts).toBe(2);
    setMailerForTests(null);
  });
});
