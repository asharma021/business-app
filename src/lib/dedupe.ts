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
 * Requires same state, similar title, and at least one financial figure within
 * tolerance, with no figure contradicting it.
 */
export function isLikelyDuplicate(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (!a.state || !b.state || a.state.toUpperCase() !== b.state.toUpperCase()) return false;
  if (a.city && b.city && a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  if (overlap(tokens(a.title), tokens(b.title)) < 0.6) return false;
  const checks = [near(a.cashFlow, b.cashFlow, 0.05), near(a.revenue, b.revenue, 0.05), near(a.askingPrice, b.askingPrice, 0.15)];
  const [cf, rev, price] = checks;
  if (cf === false || rev === false) return false; // a hard figure contradicts
  if (cf === true) return true; // cash flow within 5% is a strong signal
  return rev === true && price !== false; // otherwise need revenue match and no price contradiction
}
