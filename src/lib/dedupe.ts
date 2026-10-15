import { createHash } from "node:crypto";

const STOP = new Set(["for", "sale", "the", "a", "an", "and", "of", "in", "llc", "inc", "business", "established", "profitable", "turnkey", "tx", "texas"]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .sort()
    .join(" ");
}

/** Round to 2 significant figures so $1,249,000 and $1,250,000 match. */
export function bucket(n: number | null | undefined): string {
  if (!n || n <= 0) return "x";
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return String(Math.round(n / mag) * mag);
}

/**
 * Cross-source dedupe key. Same business on two broker sites usually shares
 * state, rough price and cash flow, and most title tokens.
 * Price is deliberately excluded when a cash-flow figure exists so that a
 * price reduction is recorded as a change, not as a new opportunity.
 */
export function fingerprint(o: {
  title: string;
  state?: string | null;
  city?: string | null;
  askingPrice?: number | null;
  cashFlow?: number | null;
  revenue?: number | null;
}): string {
  const parts = [
    (o.state ?? "").toUpperCase(),
    (o.city ?? "").toLowerCase().trim(),
    o.cashFlow ? `cf:${bucket(o.cashFlow)}` : o.revenue ? `rev:${bucket(o.revenue)}` : `p:${bucket(o.askingPrice)}`,
    normalizeTitle(o.title),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tokens(title: string) {
  return new Set(normalizeTitle(title).split(" ").filter(Boolean));
}
/** Overlap coefficient: shared tokens / size of the smaller title. Broker titles vary in length. */
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}
const near = (x: number | null | undefined, y: number | null | undefined, tol: number) =>
  x == null || y == null ? null : Math.abs(x - y) / Math.max(x, y) <= tol;

export interface DedupeCandidate {
  title: string;
  state?: string | null;
  city?: string | null;
  askingPrice?: number | null;
  cashFlow?: number | null;
  revenue?: number | null;
}

/**
 * Fuzzy duplicate check used after the exact fingerprint misses.
 * Deliberately conservative — a false merge hides a real opportunity, while a
 * missed merge only shows the same business twice. Requires:
 *  - same state (and city when both are known)
 *  - similar titles, with no conflicting numbers ("Unit 12" vs "Unit 13")
 *  - cash flow within 5% (or, if absent, revenue within 5%)
 *  - no contradicting figure (asking price more than 25% apart, revenue more than 5% apart)
 * Callers must also refuse merges between two different links from the same source (see ingest.ts).
 */
export function isLikelyDuplicate(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (!a.state || !b.state || a.state.toUpperCase() !== b.state.toUpperCase()) return false;
  if (a.city && b.city && a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  const numsA = [...ta].filter((t) => /\d/.test(t));
  const numsB = [...tb].filter((t) => /\d/.test(t));
  if (numsA.length && numsB.length && !numsA.some((n) => tb.has(n))) return false;
  if (overlap(ta, tb) < 0.6) return false;
  const cf = near(a.cashFlow, b.cashFlow, 0.05);
  const rev = near(a.revenue, b.revenue, 0.05);
  const price = near(a.askingPrice, b.askingPrice, 0.25);
  if (cf === false || rev === false || price === false) return false; // a disclosed figure contradicts
  if (cf === true) return true;
  return rev === true;
}
