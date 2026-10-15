/**
 * Failure paths and real-SDK behavior: Anthropic + Resend SDKs talk to local mock servers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailDeliveries, financialStatements, opportunities, researchCitations, researchJobs, researchReports, users } from "@/db/schema";
import { setProviderForTests } from "@/lib/ai/provider";
import { ingestCandidate } from "@/lib/ingest";
import { importCsv, importManual, ManualListingInput } from "@/lib/manual-import";
import { getOrCreatePreference } from "@/lib/preferences";
import { collectWebDiscovery, researchOpportunityById } from "@/lib/research/pipeline";
import { startJob } from "@/lib/jobs";
import { deliverDailyEmail, generateDailyReport, sendTestEmail, setMailerForTests } from "@/lib/report/deliver";
import { startMock, toolUse, webSearchTurn, anthropicMessage, type Recorded } from "./mocks";

const VALID_REPORT = {
  recommendation: "STRONG_CANDIDATE", summary: "s", whyInteresting: "w", mainRisk: "m", businessModel: "b",
  marketDemand: { rating: 4, assessment: "a", findings: [{ claim: "c", provenance: "THIRD_PARTY", sourceUrl: "https://www.bls.gov/ooh/x" }] },
  competition: { rating: 3, assessment: "a", findings: [] },
  operations: { simplicityRating: 3, ownerInvolvement: "MEDIUM", laborRequirements: "l", seasonality: "s", regulatory: "r" },
  scalability: { rating: 3, assessment: "a" }, financialObservations: [], risks: [],
  dueDiligence: { sellerQuestions: ["q"], documentsToRequest: ["d"], unresolvedConcerns: [] }, dataGaps: [],
};

let mode: "ok" | "error" | "empty" | "discovery" = "ok";
let structuredCalls = 0;
let anthropic: Awaited<ReturnType<typeof startMock>>;
let resend: Awaited<ReturnType<typeof startMock>>;
let resendMode: "ok" | "domain" = "ok";

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.RESEND_API_KEY = "re_test";
  anthropic = await startMock(47011, (req: Recorded) => {
    if (mode === "error") return { status: 500, body: { type: "error", error: { type: "api_error", message: "Internal server error" } } };
    const b = req.body as { tools?: { type?: string; name: string }[]; tool_choice?: { name: string } };
    const isSearch = b.tools?.some((t) => t.type?.startsWith("web_search"));
    if (isSearch) {
      if (mode === "empty") return { status: 200, body: anthropicMessage([{ type: "text", text: "I found no current listings." }]) };
      return { status: 200, body: webSearchTurn([{ url: "https://www.bls.gov/ooh/x", title: "BLS" }, { url: "https://broker.example/listing/9", title: "Listing 9" }], "Notes.") };
    }
    const tool = b.tool_choice?.name;
    if (tool === "record_research_report") {
      structuredCalls++;
      // First attempt is invalid to exercise the validation-retry path.
      return { status: 200, body: toolUse(tool, structuredCalls === 1 ? { recommendation: "MAYBE" } : VALID_REPORT) };
    }
    if (tool === "record_candidates") {
      return {
        status: 200,
        body: toolUse(tool, {
          candidates: [
            { url: "https://broker.example/listing/9", title: "Real listing from results", type: "ACQUISITION", industry: "HVAC", city: "Dallas", state: "TX", askingPrice: 800000, revenue: null, cashFlow: 250000, sellerFinancing: null, whyRelevant: "w" },
            { url: "https://invented.example/listing/1", title: "Hallucinated", type: "ACQUISITION", industry: null, city: null, state: "TX", askingPrice: 1, revenue: null, cashFlow: 1, sellerFinancing: null, whyRelevant: "w" },
          ],
        }),
      };
    }
    return { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: `unexpected tool ${tool}` } } };
  });
  resend = await startMock(47012, () =>
    resendMode === "ok"
      ? { status: 200, body: { id: "email_mock_1" } }
      : { status: 403, body: { statusCode: 403, name: "validation_error", message: "The example.com domain is not verified." } },
  );
});
afterAll(async () => {
  await anthropic.close();
  await resend.close();
});
afterEach(() => {
  mode = "ok";
  resendMode = "ok";
  structuredCalls = 0;
  setProviderForTests(null);
  setMailerForTests(null);
});

async function setup() {
  const [u] = await db.insert(users).values({ email: "owner@example.com" }).returning();
  const pref = await getOrCreatePreference(u.id, u.email);
  const r = await ingestCandidate({
    candidate: { type: "ACQUISITION", title: "Dallas HVAC service company", industry: "HVAC", city: "Dallas", state: "TX", askingPrice: 900000, revenue: 1500000, cashFlow: 320000, listingStatus: "ACTIVE" },
    sourceKey: "manual_url", url: "https://broker.example/listing/1", provenance: "SELLER_REPORTED",
  });
  return { u, pref, oppId: r.opportunityId };
}

describe("Anthropic SDK integration (mock server)", () => {
  it("sends authenticated requests, parses web search results and citations, and retries invalid structured output", async () => {
    const { oppId } = await setup();
    const jobId = (await startJob("OPPORTUNITY_RESEARCH", "t1", "test"))!;
    await researchOpportunityById(oppId, jobId);
    const req = anthropic.requests[0];
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.headers["anthropic-version"]).toBeTruthy();
    expect((req.body.tools as { type: string }[])[0].type).toBe("web_search_20250305");
    const structured = anthropic.requests.filter((r) => (r.body as { tool_choice?: unknown }).tool_choice);
    expect(structured).toHaveLength(2); // invalid → retried with error tool_result
    expect(JSON.stringify(structured[1].body.messages)).toContain("Validation failed");
    expect(JSON.stringify((structured[0].body.tools as unknown[])[0])).not.toContain("$schema");

    const [rep] = await db.select().from(researchReports).where(eq(researchReports.opportunityId, oppId));
    expect(rep.recommendation).toBe("PROMISING_NEEDS_VERIFICATION"); // capped: seller-reported
    expect(rep.webSearches).toBe(1);
    const cites = await db.select().from(researchCitations).where(eq(researchCitations.reportId, rep.id));
    expect(cites.map((c) => c.url)).toContain("https://www.bls.gov/ooh/x");
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
    expect(job.inputTokens).toBeGreaterThan(0);
    expect(job.webSearches).toBe(1);
  });

  it("an API outage marks the opportunity FAILED and records the error without crashing", async () => {
    const { oppId } = await setup();
    mode = "error";
    const jobId = (await startJob("OPPORTUNITY_RESEARCH", "t2", "test"))!;
    await expect(researchOpportunityById(oppId, jobId)).rejects.toThrow();
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, oppId));
    expect(o.researchStatus).toBe("FAILED");
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
    expect(job.errors).toBe(1);
    expect(await db.select().from(researchReports)).toHaveLength(0);
  }, 60_000);

  it("discovery keeps only URLs that appeared in search results", async () => {
    await setup();
    const jobId = (await startJob("DAILY_RESEARCH", "t3", "test"))!;
    await collectWebDiscovery(jobId);
    const titles = (await db.select().from(opportunities)).map((o) => o.title);
    expect(titles).toContain("Real listing from results");
    expect(titles).not.toContain("Hallucinated");
  });

  it("empty search results produce no opportunities and no error", async () => {
    await setup();
    mode = "empty";
    const jobId = (await startJob("DAILY_RESEARCH", "t4", "test"))!;
    await collectWebDiscovery(jobId);
    expect(await db.select().from(opportunities)).toHaveLength(1); // only the seeded one
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
    expect(job.errors).toBe(0);
    expect(job.sourcesSucceeded).toBe(1);
  });
});

describe("Resend SDK integration (mock server)", () => {
  it("delivers through the real SDK and logs the provider id", async () => {
    const { u, pref } = await setup();
    await generateDailyReport(u.id, pref, "2026-10-16");
    expect(await deliverDailyEmail(u.id, pref, "2026-10-16")).toBe("SENT");
    const sent = resend.requests.at(-1)!;
    expect(sent.path).toBe("/emails");
    expect(sent.headers.authorization).toBe("Bearer re_test");
    expect(sent.headers["idempotency-key"]).toBe(`daily-${u.id}-2026-10-16`);
    expect(sent.body).toMatchObject({ to: "owner@example.com", subject: "Opportunity Radar AI — Daily Business Investment Intelligence" });
    const [d] = await db.select().from(emailDeliveries);
    expect(d).toMatchObject({ status: "SENT", providerId: "email_mock_1" });
  });

  it("surfaces provider errors (e.g. unverified domain) and records the failure", async () => {
    const { u, pref } = await setup();
    resendMode = "domain";
    await generateDailyReport(u.id, pref, "2026-10-16");
    await expect(deliverDailyEmail(u.id, pref, "2026-10-16")).rejects.toThrow(/not verified/);
    const [d] = await db.select().from(emailDeliveries);
    expect(d.status).toBe("FAILED");
    expect(d.error).toMatch(/not verified/);
    await expect(sendTestEmail(u.id, "owner@example.com")).rejects.toThrow(/not verified/);
  });

  it("test email works and is logged separately from daily sends", async () => {
    const { u } = await setup();
    const r = await sendTestEmail(u.id, "owner@example.com");
    expect(r.id).toBe("email_mock_1");
    const rows = await db.select().from(emailDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "test", status: "SENT" });
  });
});

describe("manual imports without AI", () => {
  it("imports the CSV template, then merges (not duplicates) on re-upload", async () => {
    await setup();
    const csv = readFileSync("public/listing-import-template.csv", "utf8");
    const first = await importCsv(csv);
    expect(first).toMatchObject({ created: 2, merged: 0, errors: [] });
    const second = await importCsv(csv);
    expect(second).toMatchObject({ created: 0, merged: 2 });
    expect(await db.select().from(opportunities)).toHaveLength(3);
    const cleaning = (await db.select().from(opportunities)).find((o) => o.title.startsWith("Commercial cleaning"))!;
    expect(cleaning).toMatchObject({ askingPrice: 1_150_000, cashFlow: 470_000, ebitda: null, metro: "Dallas-Fort Worth" });
  });

  it("manual entry can be marked verified, which lifts the recommendation cap", async () => {
    await setup();
    const input = ManualListingInput.parse({ title: "Verified landscaping company", url: "", type: "ACQUISITION", industry: "Landscaping", city: "Frisco", state: "TX", askingPrice: "700000", revenue: "1200000", cashFlow: "", ebitda: "210000", yearEstablished: "", employees: "", sellerFinancing: "yes", description: "", verified: true });
    const r = await importManual(input);
    const [st] = await db.select().from(financialStatements).where(eq(financialStatements.opportunityId, r.opportunityId));
    expect(st.provenance).toBe("VERIFIED");
    expect(st.ebitda).toBe(210_000);
    const jobId = (await startJob("OPPORTUNITY_RESEARCH", "t5", "test"))!;
    await researchOpportunityById(r.opportunityId, jobId);
    const [rep] = await db.select().from(researchReports).where(eq(researchReports.opportunityId, r.opportunityId));
    expect(rep.recommendation).toBe("STRONG_CANDIDATE"); // verified + earnings (EBITDA) + price → not capped
  });
});
