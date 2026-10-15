/**
 * U.S. Census Bureau County Business Patterns API — official public API.
 * Docs: https://www.census.gov/data/developers/data-sets/cbp-zbp/cbp-api.html
 * Returns establishments / employees / payroll for tracked NAICS codes in the DFW MSA.
 */
import { env } from "@/lib/env";

export interface CbpConfig {
  year: number;
  naicsVar: string; // e.g. NAICS2017
  cbsa: string; // e.g. 19100
  naics: string[];
}

export interface CbpRow {
  geography: string;
  geoLabel: string;
  naics: string;
  naicsLabel: string;
  year: number;
  establishments: number | null;
  employees: number | null;
  annualPayrollThousands: number | null;
}

export function buildCbpUrl(cfg: CbpConfig, naics: string, key?: string): string {
  const u = new URL(`https://api.census.gov/data/${cfg.year}/cbp`);
  u.searchParams.set("get", `NAME,${cfg.naicsVar}_LABEL,ESTAB,EMP,PAYANN`);
  u.searchParams.set("for", `metropolitan statistical area/micropolitan statistical area:${cfg.cbsa}`);
  u.searchParams.set(cfg.naicsVar, naics);
  // Totals across all employment sizes and legal forms.
  u.searchParams.set("EMPSZES", "001");
  if (key) u.searchParams.set("key", key);
  return u.toString();
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Census returns [[header...],[row...]]. Parse defensively. */
export function parseCbpResponse(json: unknown, cfg: CbpConfig, naics: string): CbpRow | null {
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[0])) return null;
  const header = (json[0] as string[]).map(String);
  const row = json[1] as unknown[];
  const col = (name: string) => row[header.indexOf(name)];
  return {
    geography: `CBSA:${cfg.cbsa}`,
    geoLabel: String(col("NAME") ?? `CBSA ${cfg.cbsa}`),
    naics,
    naicsLabel: String(col(`${cfg.naicsVar}_LABEL`) ?? naics),
    year: cfg.year,
    establishments: num(col("ESTAB")),
    employees: num(col("EMP")),
    annualPayrollThousands: num(col("PAYANN")),
  };
}

export async function fetchCbp(cfg: CbpConfig): Promise<{ rows: CbpRow[]; errors: string[] }> {
  const key = env().CENSUS_API_KEY;
  const rows: CbpRow[] = [];
  const errors: string[] = [];
  for (const naics of cfg.naics) {
    const url = buildCbpUrl(cfg, naics, key);
    try {
      const res = await fetch(url, { headers: { "user-agent": env().HTTP_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 204) continue; // no data for this code/geography
      if (!res.ok) {
        errors.push(`NAICS ${naics}: HTTP ${res.status}`);
        continue;
      }
      const row = parseCbpResponse(await res.json(), cfg, naics);
      if (row) rows.push(row);
    } catch (e) {
      errors.push(`NAICS ${naics}: ${(e as Error).message}`);
    }
  }
  return { rows, errors };
}
