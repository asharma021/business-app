export const NOT_DISCLOSED = "Not disclosed";

/** Formats whole dollars. null/undefined → "Not disclosed" (never $0). */
export function money(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return NOT_DISCLOSED;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.compact && Math.abs(n) >= 1000 ? 1 : 0,
    notation: opts.compact ? "compact" : "standard",
  }).format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function location(o: { city?: string | null; state?: string | null; metro?: string | null }): string {
  const parts = [o.city, o.state].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return o.metro ?? "Location not disclosed";
}

/** Parses "$1.2M", "1,250,000", "$450K", "450k" → whole dollars. Returns null when not a clear figure. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/[, ]/g, "").replace(/usd/i, "").trim();
  const m = s.match(/^\$?(\d+(?:\.\d+)?)([kKmM]|mm|MM)?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === "k") v *= 1_000;
  if (unit === "m" || unit === "mm") v *= 1_000_000;
  return Math.round(v);
}

/** YYYY-MM-DD for an instant in a given IANA timezone. */
export function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function daysAgo(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
