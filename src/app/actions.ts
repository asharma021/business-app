"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { notes, notifications, opportunities, preferences, sources, userFeedback, watchlistItems } from "@/db/schema";
import { audit, rateLimited, RateLimitError } from "@/lib/audit-log";
import { FinancingDefaultsSchema } from "@/lib/preferences";
import { enqueueManualResearch, enqueueOpportunityResearch } from "@/lib/queue";
import { importFromText, importFromUrl, ImportError } from "@/lib/research/pipeline";
import { scoreMany } from "@/lib/research/scoring-service";
import { CATEGORIES, normalizeWeights } from "@/lib/scoring";

export type ActionState = { ok?: boolean; error?: string; message?: string; id?: string } | undefined;

const id = z.string().min(1).max(64);

function friendly(e: unknown): string {
  if (e instanceof ImportError || e instanceof RateLimitError || e instanceof z.ZodError) return e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid input" : e.message;
  console.error(e);
  return "Something went wrong on the server. Check the server log for details.";
}

// ───────── Opportunity actions ─────────

export async function toggleSave(opportunityId: string) {
  const user = await requireUser();
  id.parse(opportunityId);
  const [existing] = await db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, user.id), eq(watchlistItems.opportunityId, opportunityId)));
  if (existing) await db.delete(watchlistItems).where(eq(watchlistItems.id, existing.id));
  else await db.insert(watchlistItems).values({ userId: user.id, opportunityId }).onConflictDoNothing();
  await audit(user.id, existing ? "watchlist.remove" : "watchlist.add", "opportunity", opportunityId);
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/watchlist");
}

const FeedbackKind = z.enum(["INTERESTED", "NOT_INTERESTED", "TOO_EXPENSIVE", "TOO_RISKY", "TOO_MUCH_WORK", "ATTRACTIVE_CASH_FLOW", "WORTH_INVESTIGATING", "CONTACTED_SELLER"]);

export async function toggleFeedback(opportunityId: string, kind: string) {
  const user = await requireUser();
  const k = FeedbackKind.parse(kind);
  const where = and(eq(userFeedback.userId, user.id), eq(userFeedback.opportunityId, opportunityId), eq(userFeedback.kind, k));
  const [existing] = await db.select().from(userFeedback).where(where);
  if (existing) await db.delete(userFeedback).where(where);
  else await db.insert(userFeedback).values({ userId: user.id, opportunityId, kind: k });
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function setPipelineStatus(opportunityId: string, status: string) {
  const user = await requireUser();
  const s = z.enum(["NONE", "CONTACTED", "REJECTED"]).parse(status);
  await db.update(opportunities).set({ pipelineStatus: s }).where(eq(opportunities.id, opportunityId));
  await audit(user.id, `pipeline.${s.toLowerCase()}`, "opportunity", opportunityId);
  revalidatePath(`/opportunities/${opportunityId}`);
}

const NoteInput = z.object({ body: z.string().trim().min(1, "Write a note first").max(5000), dueAt: z.string().optional() });

export async function addNote(opportunityId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const n = NoteInput.parse({ body: form.get("body"), dueAt: form.get("dueAt") || undefined });
    await db.insert(notes).values({ userId: user.id, opportunityId, body: n.body, dueAt: n.dueAt ? new Date(`${n.dueAt}T09:00:00`) : null });
    revalidatePath(`/opportunities/${opportunityId}`);
    return { ok: true, message: n.dueAt ? "Follow-up added" : "Note added" };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function completeNote(noteId: string, opportunityId: string) {
  const user = await requireUser();
  await db.update(notes).set({ doneAt: new Date() }).where(and(eq(notes.id, noteId), eq(notes.userId, user.id)));
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function requestResearch(opportunityId: string): Promise<ActionState> {
  try {
    const user = await requireUser();
    await rateLimited(user.id, "research.request", 10, 60, opportunityId);
    await db.update(opportunities).set({ researchStatus: "QUEUED" }).where(eq(opportunities.id, opportunityId));
    await enqueueOpportunityResearch(opportunityId, user.id);
    revalidatePath(`/opportunities/${opportunityId}`);
    return { ok: true, message: "Research queued. The worker will update this page when it finishes." };
  } catch (e) {
    return { error: friendly(e) };
  }
}

// ───────── Import ─────────

const ImportInput = z.object({
  url: z.string().trim().url("Enter a full URL starting with https://").optional(),
  text: z.string().trim().max(60_000).optional(),
});

export async function importListing(_prev: ActionState, form: FormData): Promise<ActionState> {
  let createdId: string | undefined;
  try {
    const user = await requireUser();
    const input = ImportInput.parse({ url: form.get("url") || undefined, text: form.get("text") || undefined });
    if (!input.url && !input.text) return { error: "Paste a listing URL or the listing text." };
    await rateLimited(user.id, "listing.import", 30, 60);
    const res = input.text ? await importFromText(input.text, input.url ?? null) : await importFromUrl(input.url!);
    await audit(user.id, "listing.imported", "opportunity", res.opportunityId, { created: res.created });
    createdId = res.opportunityId;
  } catch (e) {
    return { error: friendly(e) };
  }
  redirect(`/opportunities/${createdId}?imported=1`);
}

// ───────── Research runs ─────────

export async function runResearchNow(): Promise<ActionState> {
  try {
    const user = await requireUser();
    await rateLimited(user.id, "research.run_now", 4, 60);
    await enqueueManualResearch(user.id);
    revalidatePath("/sources");
    return { ok: true, message: "Research run queued. Progress appears in the run log below." };
  } catch (e) {
    return { error: friendly(e) };
  }
}

// ───────── Settings ─────────

const money = z.coerce.number().int().min(0).max(1_000_000_000);
const optMoney = z.preprocess((v) => (v === "" || v === null ? null : v), money.nullable());
const pct = z.coerce.number().min(0).max(100);
const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function savePreferences(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const g = (k: string) => form.get(k);
    const target = money.parse(g("targetOwnerIncome"));
    const min = money.parse(g("minOwnerIncome"));
    const stretch = money.parse(g("stretchOwnerIncome"));
    if (!(min <= target && target <= stretch)) return { error: "Income thresholds must satisfy minimum ≤ target ≤ stretch." };

    const structure = z.enum(["SBA_STYLE", "SBA_PLUS_SELLER", "CONVENTIONAL", "SELLER", "CASH", "CUSTOM"]).parse(g("structure"));
    const down = pct.parse(g("downPaymentPct")) / 100;
    const seniorPct = pct.parse(g("seniorPct") || 0) / 100;
    const sellerPct = pct.parse(g("sellerPct") || 0) / 100;
    if (Math.abs(down + seniorPct + sellerPct - 1) > 0.001) return { error: "Down payment + senior loan + seller note must add up to 100%." };
    const financing = FinancingDefaultsSchema.parse({
      structure,
      downPaymentPct: down,
      seniorLoan: seniorPct > 0 ? { pct: seniorPct, ratePct: pct.parse(g("seniorRate")), termYears: z.coerce.number().positive().parse(g("seniorTerm")) } : null,
      sellerNote: sellerPct > 0 ? { pct: sellerPct, ratePct: pct.parse(g("sellerRate")), termYears: z.coerce.number().positive().parse(g("sellerTerm")) } : null,
      closingCostsPct: pct.parse(g("closingCostsPct")) / 100,
      workingCapitalPctOfPrice: pct.parse(g("workingCapitalPct")) / 100,
      operating: {
        ownerRole: z.enum(["OWNER_OPERATED", "SEMI_ABSENTEE"]).parse(g("ownerRole")),
        managerSalary: money.parse(g("managerSalary")),
        maintenanceCapex: money.parse(g("maintenanceCapex")),
        additionalOperatingCosts: money.parse(g("additionalOperatingCosts")),
        effectiveTaxRatePct: pct.parse(g("effectiveTaxRatePct")),
        contributionMarginPct: pct.parse(g("contributionMarginPct")) / 100,
        dscrThreshold: z.coerce.number().min(0).max(5).parse(g("dscrThreshold")),
      },
    });
    const weights = normalizeWeights(Object.fromEntries(CATEGORIES.map((c) => [c, z.coerce.number().min(0).max(100).parse(g(`w_${c}`) ?? 0)])));
    const hour = z.coerce.number().int().min(0).max(23).parse(g("dailyReportHour"));
    const minute = z.coerce.number().int().min(0).max(59).parse(g("dailyReportMinute"));
    const tz = z.string().refine((t) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: t });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone").parse(g("timezone"));
    const reportEmail = z.preprocess((v) => (v ? v : null), z.string().email().nullable()).parse(g("reportEmail"));

    await db
      .update(preferences)
      .set({
        targetOwnerIncome: target,
        minOwnerIncome: min,
        stretchOwnerIncome: stretch,
        capitalBudget: optMoney.parse(g("capitalBudget")),
        maxAskingPrice: optMoney.parse(g("maxAskingPrice")),
        riskTolerance: z.enum(["LOW", "MODERATE", "HIGH"]).parse(g("riskTolerance")),
        ownershipPreference: z.enum(["OWNER_OPERATED", "SEMI_ABSENTEE", "EITHER"]).parse(g("ownershipPreference")),
        primaryStates: list(g("primaryStates")).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
        primaryMetros: list(g("primaryMetros")),
        includeNationwide: g("includeNationwide") === "on",
        excludedIndustries: list(g("excludedIndustries")),
        scoringWeights: weights,
        financingDefaults: financing,
        timezone: tz,
        dailyReportHour: hour,
        dailyReportMinute: minute,
        dailyEmailEnabled: g("dailyEmailEnabled") === "on",
        reportEmail,
      })
      .where(eq(preferences.userId, user.id));
    await audit(user.id, "preferences.update");
    const n = await scoreMany();
    revalidatePath("/", "layout");
    return { ok: true, message: `Settings saved. Re-scored ${n} opportunit${n === 1 ? "y" : "ies"} with your new assumptions.` };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function saveRssFeeds(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const feeds = String(form.get("feeds") ?? "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const f of feeds) z.string().url(`Not a valid URL: ${f}`).refine((u) => u.startsWith("https://") || u.startsWith("http://"), "Feeds must be http(s)").parse(f);
    const confirm = form.get("confirm") === "on";
    if (feeds.length && !confirm) return { error: "Confirm that you're permitted to use these feeds." };
    await db.update(sources).set({ config: { feeds }, enabled: feeds.length > 0 }).where(eq(sources.key, "rss_feeds"));
    await audit(user.id, "sources.rss_update", "source", "rss_feeds", { count: feeds.length });
    revalidatePath("/sources");
    return { ok: true, message: feeds.length ? `Saved ${feeds.length} feed(s).` : "Feeds cleared; RSS source disabled." };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function toggleSource(key: string, enabled: boolean) {
  const user = await requireUser();
  const [s] = await db.select().from(sources).where(eq(sources.key, key));
  // Proposed sources can never be enabled from the UI — they need a vetted integration first.
  if (!s || s.access === "PROPOSED" || s.access === "DISABLED") return;
  await db.update(sources).set({ enabled }).where(eq(sources.id, s.id));
  await audit(user.id, enabled ? "sources.enable" : "sources.disable", "source", key);
  revalidatePath("/sources");
}

export async function markNotificationsRead() {
  const user = await requireUser();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath("/", "layout");
}
