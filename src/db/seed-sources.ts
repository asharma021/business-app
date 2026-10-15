/**
 * Source registry. Only CONFIRMED + enabled sources are fetched automatically.
 * PROPOSED sources are listed so you can see what was considered and why it
 * isn't automated — they are never fetched.
 */
import { sql } from "drizzle-orm";
import type { DB } from "./index";
import { sources } from "./schema";

type SeedSource = typeof sources.$inferInsert;

export const DFW_CBSA = "19100"; // Dallas-Fort Worth-Arlington, TX MSA

/** NAICS codes tracked for market context (service-heavy, recurring-revenue leaning). */
export const TRACKED_NAICS: Record<string, string> = {
  "561720": "Janitorial services",
  "561730": "Landscaping services",
  "238220": "Plumbing, heating, and air-conditioning contractors",
  "561710": "Exterminating and pest control services",
  "541512": "Computer systems design services",
  "541513": "Computer facilities management services",
  "532490": "Other commercial and industrial machinery and equipment rental",
  "532120": "Truck, utility trailer, and RV rental and leasing",
  "811192": "Car washes",
  "812930": "Parking lots and garages",
  "621610": "Home health care services",
  "624120": "Services for the elderly and persons with disabilities",
  "484110": "General freight trucking, local",
  "493110": "General warehousing and storage",
  "531130": "Lessors of miniwarehouses and self-storage units",
};

export const SOURCE_SEED: SeedSource[] = [
  {
    key: "census_cbp",
    name: "U.S. Census Bureau — County Business Patterns API",
    kind: "API",
    access: "CONFIRMED",
    enabled: true,
    reliability: 95,
    homepage: "https://www.census.gov/data/developers/data-sets/cbp-zbp/cbp-api.html",
    termsNote:
      "Official public API. Works without a key at low volume; set CENSUS_API_KEY (free) for reliable use. Provides establishment, employment and payroll counts by NAICS for the DFW MSA — market context, not listings.",
    config: { year: 2023, naicsVar: "NAICS2017", cbsa: DFW_CBSA, naics: Object.keys(TRACKED_NAICS) },
  },
  {
    key: "claude_web_search",
    name: "Claude API web search (listing discovery + research)",
    kind: "WEB_SEARCH",
    access: "CONFIRMED",
    enabled: true,
    reliability: 55,
    homepage: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool",
    termsNote:
      "Uses Anthropic's server-side web_search tool (billed per search). Candidates are kept only if their URL appears in the actual search results; figures from snippets are stored as SELLER_REPORTED and unverified. Listing pages are not crawled.",
    config: {},
  },
  {
    key: "rss_feeds",
    name: "Broker / franchisor RSS feeds you configure",
    kind: "RSS",
    access: "CONFIRMED",
    enabled: false,
    reliability: 70,
    termsNote:
      "Add feed URLs you are permitted to consume (e.g. a broker's published listings feed). robots.txt is checked before each fetch. Disabled until at least one feed is added in Settings → Sources.",
    config: { feeds: [] },
  },
  {
    key: "manual_url",
    name: "Manual URL import",
    kind: "MANUAL_URL",
    access: "MANUAL_ONLY",
    enabled: true,
    reliability: 70,
    termsNote:
      "You paste a listing URL. The page is fetched once only if robots.txt allows it; otherwise paste the listing text yourself. No logins, CAPTCHAs or paywalls are bypassed.",
    config: {},
  },
  {
    key: "document",
    name: "Pasted text / document import",
    kind: "DOCUMENT",
    access: "MANUAL_ONLY",
    enabled: true,
    reliability: 75,
    termsNote: "Text you paste (listing, CIM excerpt, broker email). Treated as untrusted data during extraction.",
    config: {},
  },
  {
    key: "manual_entry",
    name: "Manual entry form",
    kind: "DOCUMENT",
    access: "MANUAL_ONLY",
    enabled: true,
    reliability: 75,
    termsNote: "Figures you type in from a listing or documents. Marked verified only when you tick that box.",
    config: {},
  },
  {
    key: "csv_import",
    name: "CSV upload",
    kind: "DOCUMENT",
    access: "MANUAL_ONLY",
    enabled: true,
    reliability: 70,
    termsNote: "Spreadsheet of listings you collected. Parsed deterministically — no AI needed.",
    config: {},
  },
  // ── Proposed / not automated ──────────────────────────────────────────
  ...(
    [
      ["bizbuysell", "BizBuySell", "https://www.bizbuysell.com", "No public listings API identified. Use manual URL import, or pursue a licensed data agreement before automating."],
      ["bizquest", "BizQuest", "https://www.bizquest.com", "No public listings API identified. Manual URL import only."],
      ["businessesforsale", "BusinessesForSale.com", "https://www.businessesforsale.com", "No public listings API identified. Manual URL import only."],
      ["loopnet", "LoopNet", "https://www.loopnet.com", "Commercial real estate marketplace; terms restrict automated access. Manual URL import only."],
      ["franchise_direct", "Franchise Direct", "https://www.franchisedirect.com", "Directory site; no public API identified. Manual import only."],
      ["franchise_gator", "Franchise Gator", "https://www.franchisegator.com", "Directory site; no public API identified. Manual import only."],
      ["wi_dfi_fdd", "Wisconsin DFI franchise filings (FDDs)", "https://www.wdfi.org/fi/securities/franchise/", "Public FDD search. Candidate for Phase 2 franchise research — verify permitted access before automating."],
      ["ca_dfpi_fdd", "California DFPI franchise filings (FDDs)", "https://dfpi.ca.gov/", "Public FDD search. Candidate for Phase 2."],
      ["bls_api", "Bureau of Labor Statistics API", "https://www.bls.gov/developers/", "Documented public API (registration key). Planned for Phase 2 wage/employment trends."],
      ["fred_api", "FRED (St. Louis Fed) API", "https://fred.stlouisfed.org/docs/api/fred/", "Documented public API (free key). Planned for Phase 2 rates and macro context."],
      ["sba_data", "SBA open data", "https://data.sba.gov/", "Public datasets (e.g. 7(a) loan data). Planned for Phase 2 franchise/industry loan-performance context."],
      ["google_trends", "Google Trends", "https://trends.google.com", "No official public API for general use. Not automated."],
      ["reddit", "Reddit discussions", "https://www.reddit.com", "API requires approval and has usage terms. Not automated."],
    ] as const
  ).map(
    ([key, name, homepage, termsNote]): SeedSource => ({
      key,
      name,
      kind: "API",
      access: "PROPOSED",
      enabled: false,
      reliability: 50,
      homepage,
      termsNote,
      config: {},
    }),
  ),
];

/** Idempotent: inserts missing sources, refreshes descriptive fields, never touches enabled/config. */
export async function seedSources(db: DB) {
  for (const s of SOURCE_SEED) {
    await db
      .insert(sources)
      .values(s)
      .onConflictDoUpdate({
        target: sources.key,
        set: { name: s.name, termsNote: s.termsNote, homepage: s.homepage, access: sql`excluded.access` },
      });
  }
}
