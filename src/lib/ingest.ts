/**
 * Ingest a discovered/imported listing: dedupe across sources, attach the
 * listing, record price/status changes, and store reported figures with provenance.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { dataRefreshes, financialStatements, listings, opportunities, sourceRecords, sources } from "@/db/schema";
import { contentHash, fingerprint, isLikelyDuplicate } from "@/lib/dedupe";

export interface Candidate {
  type: "ACQUISITION" | "FRANCHISE" | "EMERGING";
  title: string;
  description?: string | null;
  industry?: string | null;
  naicsCode?: string | null;
  city?: string | null;
  state?: string | null;
  askingPrice?: number | null;
  revenue?: number | null;
  cashFlow?: number | null;
  ebitda?: number | null;
  yearEstablished?: number | null;
  employees?: number | null;
  sellerFinancing?: boolean | null;
  sellerFinancingNote?: string | null;
  ownerInvolvement?: string | null;
  listingStatus?: "ACTIVE" | "UNDER_CONTRACT" | "OFF_MARKET" | "UNKNOWN";
}

// Principal cities/suburbs of the Dallas-Fort Worth-Arlington MSA (non-exhaustive; unknown cities stay unassigned).
const DFW_CITIES = new Set([
  "dallas", "fort worth", "arlington", "plano", "irving", "garland", "frisco", "mckinney", "grand prairie", "denton",
  "mesquite", "carrollton", "richardson", "lewisville", "allen", "flower mound", "north richland hills", "mansfield",
  "rowlett", "euless", "desoto", "grapevine", "bedford", "cedar hill", "wylie", "keller", "coppell", "rockwall",
  "burleson", "hurst", "the colony", "haltom city", "southlake", "prosper", "little elm", "sachse", "weatherford",
  "waxahachie", "midlothian", "forney", "colleyville", "addison", "farmers branch", "duncanville", "lancaster",
  "celina", "anna", "princeton", "argyle", "roanoke", "trophy club", "saginaw", "benbrook", "azle", "crowley",
]);

export function inferMetro(city?: string | null, state?: string | null): string | null {
  if (state?.toUpperCase() !== "TX" || !city) return null;
  return DFW_CITIES.has(city.trim().toLowerCase()) ? "Dallas-Fort Worth" : null;
}

export function missingFields(c: Candidate): string[] {
  const m: string[] = [];
  if (c.askingPrice == null) m.push("askingPrice");
  if (c.revenue == null) m.push("revenue");
  if (c.cashFlow == null) m.push("cashFlow");
  if (!c.state) m.push("location");
  if (!c.industry) m.push("industry");
  if (c.sellerFinancing == null) m.push("sellerFinancing");
  return m;
}

export async function recordEvidence(sourceKey: string, opts: { url?: string | null; text: string; httpStatus?: number | null; robotsAllowed?: boolean | null; contentType?: string | null }) {
  const [src] = await db.select({ id: sources.id }).from(sources).where(eq(sources.key, sourceKey));
  if (!src) throw new Error(`Unknown source ${sourceKey}`);
  const [rec] = await db
    .insert(sourceRecords)
    .values({
      sourceId: src.id,
      url: opts.url ?? null,
      httpStatus: opts.httpStatus ?? null,
      robotsAllowed: opts.robotsAllowed ?? null,
      contentType: opts.contentType ?? null,
      contentHash: contentHash(opts.text),
      excerpt: opts.text.slice(0, 20_000),
    })
    .returning({ id: sourceRecords.id });
  return { sourceId: src.id, sourceRecordId: rec.id };
}

export interface IngestResult {
  opportunityId: string;
  created: boolean;
  changes: { field: string; oldValue: string | null; newValue: string | null }[];
}

const TRACKED: (keyof Candidate & keyof typeof opportunities.$inferSelect)[] = ["askingPrice", "revenue", "cashFlow", "sellerFinancing", "listingStatus"];

export async function ingestCandidate(opts: {
  candidate: Candidate;
  sourceKey: string;
  url: string;
  sourceRecordId?: string | null;
  provenance: "SELLER_REPORTED" | "THIRD_PARTY" | "VERIFIED";
  jobId?: string | null;
}): Promise<IngestResult> {
  const c = { ...opts.candidate, state: opts.candidate.state?.toUpperCase() ?? null };
  const [src] = await db.select({ id: sources.id }).from(sources).where(eq(sources.key, opts.sourceKey));
  if (!src) throw new Error(`Unknown source ${opts.sourceKey}`);

  return db.transaction(async (tx) => {
    // 1. Same URL already known for this source?
    const [existingListing] = await tx.select().from(listings).where(and(eq(listings.sourceId, src.id), eq(listings.url, opts.url)));
    let oppId: string | null = existingListing?.opportunityId ?? null;

    // 2. Exact fingerprint match across sources.
    const fp = fingerprint(c);
    if (!oppId) {
      const [byFp] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.fingerprint, fp));
      oppId = byFp?.id ?? null;
    }
    // 3. Fuzzy match among recent same-state opportunities.
    if (!oppId && c.state) {
      const recent = await tx
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.state, c.state), gte(opportunities.firstDiscoveredAt, new Date(Date.now() - 365 * 86_400_000))))
        .limit(500);
      oppId = recent.find((o) => isLikelyDuplicate(o, c))?.id ?? null;
    }

    const changes: IngestResult["changes"] = [];
    let created = false;
    const fields = {
      type: c.type,
      title: c.title.slice(0, 200),
      description: c.description ?? null,
      industry: c.industry ?? null,
      naicsCode: c.naicsCode ?? null,
      city: c.city ?? null,
      state: c.state,
      metro: inferMetro(c.city, c.state),
      askingPrice: c.askingPrice ?? null,
      revenue: c.revenue ?? null,
      cashFlow: c.cashFlow ?? null,
      ebitda: c.ebitda ?? null,
      yearEstablished: c.yearEstablished ?? null,
      employees: c.employees ?? null,
      sellerFinancing: c.sellerFinancing ?? null,
      sellerFinancingNote: c.sellerFinancingNote ?? null,
      ownerInvolvement: c.ownerInvolvement ?? null,
      listingStatus: c.listingStatus ?? "ACTIVE",
    };

    if (!oppId) {
      const [row] = await tx
        .insert(opportunities)
        .values({ ...fields, fingerprint: fp, missingFields: missingFields(c), lastVerifiedAt: new Date() })
        .returning({ id: opportunities.id });
      oppId = row.id;
      created = true;
    } else {
      const [prev] = await tx.select().from(opportunities).where(eq(opportunities.id, oppId));
      // Only overwrite with disclosed values — a source that omits a figure must not erase it.
      const patch: Record<string, unknown> = { lastVerifiedAt: new Date() };
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === undefined || k === "title" || k === "type") continue;
        const old = (prev as Record<string, unknown>)[k];
        if (old !== v) {
          patch[k] = v;
          if ((TRACKED as string[]).includes(k)) changes.push({ field: k, oldValue: old == null ? null : String(old), newValue: String(v) });
        }
      }
      const merged = { ...prev, ...patch } as Candidate;
      patch.missingFields = missingFields(merged);
      await tx.update(opportunities).set(patch).where(eq(opportunities.id, oppId));
      if (changes.length) {
        await tx.insert(dataRefreshes).values(changes.map((ch) => ({ opportunityId: oppId!, jobId: opts.jobId ?? null, ...ch })));
      }
    }

    await tx
      .insert(listings)
      .values({ opportunityId: oppId, sourceId: src.id, sourceRecordId: opts.sourceRecordId ?? null, url: opts.url, title: fields.title, askingPrice: fields.askingPrice, status: fields.listingStatus })
      .onConflictDoUpdate({
        target: [listings.sourceId, listings.url],
        set: { lastSeenAt: new Date(), askingPrice: fields.askingPrice, status: fields.listingStatus, sourceRecordId: opts.sourceRecordId ?? null },
      });

    if (c.revenue != null || c.cashFlow != null || c.ebitda != null) {
      await tx.insert(financialStatements).values({
        opportunityId: oppId,
        sourceRecordId: opts.sourceRecordId ?? null,
        periodLabel: "As listed",
        provenance: opts.provenance,
        revenue: c.revenue ?? null,
        sde: c.cashFlow ?? null,
        ebitda: c.ebitda ?? null,
        notes: `Reported via ${opts.sourceKey}: ${opts.url}`,
      });
    }

    if (created || changes.length) {
      await tx.update(opportunities).set({ researchStatus: "QUEUED" }).where(eq(opportunities.id, oppId));
    }
    return { opportunityId: oppId, created, changes };
  });
}
