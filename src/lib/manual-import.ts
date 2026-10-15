/**
 * Deterministic imports that don't need AI: a CSV of listings, or one listing typed into a form.
 * Figures are stored exactly as given; blanks stay "not disclosed".
 */
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { contentHash } from "@/lib/dedupe";
import { parseMoney } from "@/lib/format";
import { ingestCandidate, recordEvidence, type Candidate, type IngestResult } from "@/lib/ingest";
import { scoreOpportunity } from "@/lib/research/scoring-service";

export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 500;
export const CSV_COLUMNS = [
  "title",
  "url",
  "type",
  "industry",
  "city",
  "state",
  "asking_price",
  "revenue",
  "cash_flow",
  "ebitda",
  "year_established",
  "employees",
  "seller_financing",
  "description",
] as const;

const ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  name: "title", business: "title", listing: "title", link: "url", listing_url: "url",
  price: "asking_price", asking: "asking_price", gross_revenue: "revenue", sales: "revenue",
  sde: "cash_flow", cashflow: "cash_flow", seller_discretionary_earnings: "cash_flow",
  established: "year_established", year: "year_established", seller_finance: "seller_financing",
};

const norm = (h: string) => {
  const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return (CSV_COLUMNS as readonly string[]).includes(k) ? k : ALIASES[k] ?? null;
};

export interface ParsedRow {
  line: number;
  candidate: Candidate;
  url: string | null;
}
export interface RowError {
  line: number;
  message: string;
}

function moneyCell(v: string | undefined, field: string, line: number, errors: RowError[]): number | null {
  if (!v || !v.trim() || /^(n\/?a|not disclosed|-|—)$/i.test(v.trim())) return null;
  const n = parseMoney(v);
  if (n === null) errors.push({ line, message: `${field}: "${v}" isn't a dollar amount (use 450000, $450,000 or 450K)` });
  return n;
}

function boolCell(v: string | undefined): boolean | null {
  if (!v || !v.trim()) return null;
  if (/^(y|yes|true|1|available)$/i.test(v.trim())) return true;
  if (/^(n|no|false|0|none)$/i.test(v.trim())) return false;
  return null;
}

function intCell(v: string | undefined, min: number, max: number): number | null {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function parseListingCsv(text: string): { rows: ParsedRow[]; errors: RowError[]; unknownColumns: string[] } {
  if (text.length > CSV_MAX_BYTES) return { rows: [], errors: [{ line: 0, message: "File is larger than 1 MB" }], unknownColumns: [] };
  let records: string[][];
  try {
    records = parse(text.replace(/^﻿/, ""), { relax_column_count: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: `Couldn't read the CSV: ${(e as Error).message}` }], unknownColumns: [] };
  }
  if (records.length < 2) return { rows: [], errors: [{ line: 0, message: "The CSV needs a header row and at least one listing" }], unknownColumns: [] };
  const header = records[0].map(norm);
  const unknownColumns = records[0].filter((_, i) => header[i] === null);
  if (!header.includes("title")) return { rows: [], errors: [{ line: 1, message: "A 'title' column is required" }], unknownColumns };
  if (records.length - 1 > CSV_MAX_ROWS) return { rows: [], errors: [{ line: 0, message: `Too many rows (max ${CSV_MAX_ROWS})` }], unknownColumns };

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  records.slice(1).forEach((rec, i) => {
    const line = i + 2;
    const get = (k: (typeof CSV_COLUMNS)[number]) => {
      const idx = header.indexOf(k);
      return idx >= 0 ? rec[idx] : undefined;
    };
    const title = get("title")?.trim();
    if (!title) return errors.push({ line, message: "Missing title" });
    const before = errors.length;
    const state = get("state")?.trim().toUpperCase() || null;
    if (state && !/^[A-Z]{2}$/.test(state)) errors.push({ line, message: `state: "${state}" should be a two-letter code like TX` });
    const urlRaw = get("url")?.trim() || null;
    const url = urlRaw && /^https?:\/\/\S+$/i.test(urlRaw) ? urlRaw : null;
    if (urlRaw && !url) errors.push({ line, message: `url: "${urlRaw}" isn't a full http(s) link` });
    const type = /franchise/i.test(get("type") ?? "") ? "FRANCHISE" : "ACQUISITION";
    const candidate: Candidate = {
      type,
      title: title.slice(0, 200),
      description: get("description")?.slice(0, 2000) || null,
      industry: get("industry")?.slice(0, 120) || null,
      city: get("city")?.slice(0, 80) || null,
      state,
      askingPrice: moneyCell(get("asking_price"), "asking_price", line, errors),
      revenue: moneyCell(get("revenue"), "revenue", line, errors),
      cashFlow: moneyCell(get("cash_flow"), "cash_flow", line, errors),
      ebitda: moneyCell(get("ebitda"), "ebitda", line, errors),
      yearEstablished: intCell(get("year_established"), 1800, 2100),
      employees: intCell(get("employees"), 0, 1_000_000),
      sellerFinancing: boolCell(get("seller_financing")),
      listingStatus: "ACTIVE",
    };
    if (errors.length === before) rows.push({ line, candidate, url });
  });
  return { rows, errors, unknownColumns };
}

export interface CsvImportSummary {
  created: number;
  merged: number;
  rowsRead: number;
  errors: RowError[];
  unknownColumns: string[];
  opportunityIds: string[];
}

export async function importCsv(text: string): Promise<CsvImportSummary> {
  const { rows, errors, unknownColumns } = parseListingCsv(text);
  const summary: CsvImportSummary = { created: 0, merged: 0, rowsRead: rows.length + errors.length, errors: [...errors], unknownColumns, opportunityIds: [] };
  if (!rows.length) return summary;
  const ev = await recordEvidence("csv_import", { text: text.slice(0, 20_000), contentType: "text/csv" });
  for (const r of rows) {
    try {
      const res: IngestResult = await ingestCandidate({
        candidate: r.candidate,
        sourceKey: "csv_import",
        url: r.url ?? `csv:${contentHash(JSON.stringify(r.candidate)).slice(0, 24)}`,
        sourceRecordId: ev.sourceRecordId,
        provenance: "SELLER_REPORTED",
      });
      if (res.created) summary.created++;
      else summary.merged++;
      summary.opportunityIds.push(res.opportunityId);
      await scoreOpportunity(res.opportunityId);
    } catch (e) {
      summary.errors.push({ line: r.line, message: `Couldn't save: ${(e as Error).message}` });
    }
  }
  return summary;
}

// ───────── Manual entry form ─────────

const optMoney = z.preprocess((v) => (v === "" || v == null ? null : parseMoney(String(v)) ?? Number.NaN), z.number().int().nonnegative("Enter a dollar amount").nullable());
const optInt = (min: number, max: number) => z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(min).max(max).nullable());
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(max).nullable());

export const ManualListingInput = z.object({
  title: z.string().trim().min(3, "Give the listing a title").max(200),
  url: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().url("Enter a full link starting with https://").nullable()),
  type: z.enum(["ACQUISITION", "FRANCHISE"]),
  industry: optText(120),
  city: optText(80),
  state: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{2}$/, "Use a two-letter state code").nullable()),
  askingPrice: optMoney,
  revenue: optMoney,
  cashFlow: optMoney,
  ebitda: optMoney,
  yearEstablished: optInt(1800, 2100),
  employees: optInt(0, 1_000_000),
  sellerFinancing: z.enum(["", "yes", "no"]).transform((v) => (v === "yes" ? true : v === "no" ? false : null)),
  description: optText(2000),
  verified: z.boolean(),
});
export type ManualListingInput = z.infer<typeof ManualListingInput>;

export async function importManual(input: ManualListingInput) {
  const { verified, url, ...rest } = input;
  const candidate: Candidate = { ...rest, listingStatus: "ACTIVE" };
  const text = JSON.stringify(input);
  const ev = await recordEvidence("manual_entry", { url, text });
  const res = await ingestCandidate({
    candidate,
    sourceKey: "manual_entry",
    url: url ?? `manual:${ev.sourceRecordId}`,
    sourceRecordId: ev.sourceRecordId,
    // Only the user can mark figures verified (e.g. checked against tax returns).
    provenance: verified ? "VERIFIED" : "SELLER_REPORTED",
  });
  await scoreOpportunity(res.opportunityId);
  return res;
}
