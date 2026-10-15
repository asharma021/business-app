import { z } from "zod";

const money = z.number().int().nonnegative().nullable().describe("Whole US dollars, or null if not stated in the source. Never estimate.");
const url = z.string().url().nullable().describe("A URL that appears in the provided evidence, or null.");
const rating = z.number().int().min(1).max(5).nullable().describe("1 (poor) to 5 (excellent), or null if evidence is insufficient.");

export const ProvenanceEnum = z.enum(["SELLER_REPORTED", "THIRD_PARTY", "AI_ESTIMATE"]);

export const Finding = z.object({
  claim: z.string().max(600),
  provenance: ProvenanceEnum.describe(
    "SELLER_REPORTED = from the listing/broker; THIRD_PARTY = from an independent source you cite; AI_ESTIMATE = your own reasoning or assumption.",
  ),
  sourceUrl: url,
});
export type Finding = z.infer<typeof Finding>;

/** Listing → structured opportunity. Used for manual URL, pasted text and RSS items. */
export const ListingExtraction = z.object({
  isBusinessForSale: z.boolean().describe("True only if the content describes a specific business, franchise resale, or franchise offering."),
  type: z.enum(["ACQUISITION", "FRANCHISE"]),
  title: z.string().max(200).describe("Listing title or a short anonymized description. Never invent a business name."),
  description: z.string().max(2000).nullable(),
  industry: z.string().max(120).nullable(),
  naicsCode: z.string().regex(/^\d{2,6}$/).nullable(),
  city: z.string().max(80).nullable(),
  state: z.string().length(2).nullable().describe("Two-letter US state code"),
  askingPrice: money,
  revenue: money.describe("Gross annual revenue as stated"),
  cashFlow: money.describe("Seller's discretionary earnings / cash flow as stated"),
  ebitda: money,
  yearEstablished: z.number().int().min(1800).max(2100).nullable(),
  employees: z.number().int().nonnegative().nullable(),
  sellerFinancing: z.boolean().nullable().describe("true/false only if explicitly stated"),
  sellerFinancingNote: z.string().max(300).nullable(),
  ownerInvolvement: z.string().max(300).nullable(),
  listingStatus: z.enum(["ACTIVE", "UNDER_CONTRACT", "OFF_MARKET", "UNKNOWN"]),
});
export type ListingExtraction = z.infer<typeof ListingExtraction>;

/** Web-search discovery output. Each candidate MUST carry a URL from the search results. */
export const DiscoveryResult = z.object({
  candidates: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().max(200),
        type: z.enum(["ACQUISITION", "FRANCHISE"]),
        industry: z.string().max(120).nullable(),
        city: z.string().max(80).nullable(),
        state: z.string().length(2).nullable(),
        askingPrice: money,
        revenue: money,
        cashFlow: money,
        sellerFinancing: z.boolean().nullable(),
        whyRelevant: z.string().max(400),
      }),
    )
    .max(25),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;

/** Research report — Agents 2 (business), 3 (financial observations), 4 (risk). */
export const ResearchReportSchema = z.object({
  recommendation: z.enum([
    "STRONG_CANDIDATE",
    "PROMISING_NEEDS_VERIFICATION",
    "HIGH_RISK",
    "FINANCIALLY_UNATTRACTIVE",
    "INSUFFICIENT_DATA",
  ]),
  summary: z.string().max(1500),
  whyInteresting: z.string().max(500),
  mainRisk: z.string().max(400),
  businessModel: z.string().max(1500),
  marketDemand: z.object({ rating, assessment: z.string().max(1500), findings: z.array(Finding).max(10) }),
  competition: z.object({
    rating: rating.describe("Defensibility / competitive position: 5 = strong advantage"),
    assessment: z.string().max(1200),
    findings: z.array(Finding).max(8),
  }),
  operations: z.object({
    simplicityRating: rating.describe("5 = simple to operate, 1 = very complex"),
    ownerInvolvement: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
    laborRequirements: z.string().max(800),
    seasonality: z.string().max(500),
    regulatory: z.string().max(800),
  }),
  scalability: z.object({ rating, assessment: z.string().max(800) }),
  financialObservations: z.array(Finding).max(12),
  risks: z
    .array(
      z.object({
        category: z.enum([
          "CUSTOMER_CONCENTRATION",
          "OWNER_DEPENDENCY",
          "EMPLOYEE_TURNOVER",
          "FRANCHISE_TERMS",
          "LEASE",
          "REGULATORY",
          "FINANCING",
          "SUPPLIER_CONCENTRATION",
          "COMPETITION",
          "TECHNOLOGY_DISRUPTION",
          "CYCLICALITY",
          "CASH_FLOW_VOLATILITY",
          "DATA_QUALITY",
          "OTHER",
        ]),
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
        description: z.string().max(500),
        sourceUrl: url,
      }),
    )
    .max(15),
  dueDiligence: z.object({
    sellerQuestions: z.array(z.string().max(300)).max(15),
    documentsToRequest: z.array(z.string().max(200)).max(15),
    unresolvedConcerns: z.array(z.string().max(300)).max(10),
  }),
  dataGaps: z.array(z.string().max(200)).max(15),
});
export type ResearchReportData = z.infer<typeof ResearchReportSchema>;
