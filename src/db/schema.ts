/**
 * Opportunity Radar AI — database schema (Drizzle ORM / PostgreSQL)
 *
 * Money is stored as whole US dollars in integer columns.
 * NULL always means "not disclosed / unknown" and must never be rendered as $0.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ───────────────────────── Enums ─────────────────────────

export const riskTolerance = pgEnum("risk_tolerance", ["LOW", "MODERATE", "HIGH"]);
export const ownershipPreference = pgEnum("ownership_preference", [
  "OWNER_OPERATED",
  "SEMI_ABSENTEE",
  "EITHER",
]);
export const sourceKind = pgEnum("source_kind", ["API", "RSS", "WEB_SEARCH", "MANUAL_URL", "DOCUMENT"]);
export const sourceAccess = pgEnum("source_access", [
  "CONFIRMED", // documented public API/feed the user is permitted to use
  "PROPOSED", // candidate only — never fetched automatically
  "MANUAL_ONLY", // user-supplied URL or document only
  "DISABLED",
]);
export const opportunityType = pgEnum("opportunity_type", ["ACQUISITION", "FRANCHISE", "EMERGING"]);
export const listingStatus = pgEnum("listing_status", [
  "ACTIVE",
  "UNDER_CONTRACT",
  "OFF_MARKET",
  "ARCHIVED",
  "UNKNOWN",
]);
export const researchStatus = pgEnum("research_status", [
  "NEW",
  "QUEUED",
  "RESEARCHING",
  "RESEARCHED",
  "NEEDS_INFO",
  "FAILED",
]);
export const pipelineStatus = pgEnum("pipeline_status", ["NONE", "CONTACTED", "REJECTED"]);
export const provenance = pgEnum("provenance", [
  "VERIFIED", // documents the user confirmed (tax returns, audited P&L)
  "SELLER_REPORTED", // listing / broker / seller claim
  "THIRD_PARTY", // benchmarks, FDD Item 19, government data
  "AI_ESTIMATE", // model-generated assumption — never presented as fact
]);
export const scenarioKind = pgEnum("scenario_kind", ["CONSERVATIVE", "BASE", "OPTIMISTIC", "CUSTOM"]);
export const recommendation = pgEnum("recommendation", [
  "STRONG_CANDIDATE",
  "PROMISING_NEEDS_VERIFICATION",
  "HIGH_RISK",
  "FINANCIALLY_UNATTRACTIVE",
  "INSUFFICIENT_DATA",
]);
export const feedbackKind = pgEnum("feedback_kind", [
  "INTERESTED",
  "NOT_INTERESTED",
  "TOO_EXPENSIVE",
  "TOO_RISKY",
  "TOO_MUCH_WORK",
  "ATTRACTIVE_CASH_FLOW",
  "WORTH_INVESTIGATING",
  "CONTACTED_SELLER",
]);
export const jobKind = pgEnum("job_kind", [
  "DAILY_RESEARCH",
  "MANUAL_RESEARCH",
  "OPPORTUNITY_RESEARCH",
  "MARKET_DATA",
  "IMPORT",
]);
export const jobStatus = pgEnum("job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]);
export const deliveryStatus = pgEnum("delivery_status", ["PENDING", "SENT", "FAILED", "SKIPPED"]);

// ───────────────────────── Auth.js tables ─────────────────────────

export const users = pgTable("user", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ───────────────────────── Preferences ─────────────────────────

export const preferences = pgTable("preference", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  targetOwnerIncome: integer("target_owner_income").notNull().default(150000),
  minOwnerIncome: integer("min_owner_income").notNull().default(100000),
  stretchOwnerIncome: integer("stretch_owner_income").notNull().default(250000),
  capitalBudget: integer("capital_budget"), // user-defined; null = not set, never assumed
  maxAskingPrice: integer("max_asking_price"),
  riskTolerance: riskTolerance("risk_tolerance").notNull().default("MODERATE"),
  ownershipPreference: ownershipPreference("ownership_preference").notNull().default("OWNER_OPERATED"),
  primaryStates: text("primary_states").array().notNull().default(sql`ARRAY['TX']::text[]`),
  primaryMetros: text("primary_metros")
    .array()
    .notNull()
    .default(sql`ARRAY['Dallas-Fort Worth']::text[]`),
  includeNationwide: boolean("include_nationwide").notNull().default(true),
  excludedIndustries: text("excluded_industries").array().notNull().default(sql`ARRAY[]::text[]`),
  scoringWeights: jsonb("scoring_weights").$type<Record<string, number>>(),
  financingDefaults: jsonb("financing_defaults").$type<Record<string, unknown>>(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  dailyReportHour: integer("daily_report_hour").notNull().default(7),
  dailyReportMinute: integer("daily_report_minute").notNull().default(0),
  dailyEmailEnabled: boolean("daily_email_enabled").notNull().default(true),
  reportEmail: text("report_email"),
  updatedAt: updatedAt(),
});

// ───────────────────────── Sources & evidence ─────────────────────────

export const sources = pgTable("source", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: sourceKind("kind").notNull(),
  access: sourceAccess("access").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  reliability: integer("reliability").notNull().default(50), // 0–100
  homepage: text("homepage"),
  termsNote: text("terms_note"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  lastRunAt: timestamp("last_run_at", { mode: "date" }),
  lastSuccessAt: timestamp("last_success_at", { mode: "date" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Raw evidence: every fetched page, API response, or pasted document. */
export const sourceRecords = pgTable(
  "source_record",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    url: text("url"),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).notNull().defaultNow(),
    httpStatus: integer("http_status"),
    robotsAllowed: boolean("robots_allowed"),
    contentHash: text("content_hash").notNull(),
    contentType: text("content_type"),
    excerpt: text("excerpt"),
  },
  (t) => [index("source_record_source_idx").on(t.sourceId, t.fetchedAt), index("source_record_hash_idx").on(t.contentHash)],
);

// ───────────────────────── Opportunities ─────────────────────────

export const opportunities = pgTable(
  "opportunity",
  {
    id: id(),
    type: opportunityType("type").notNull().default("ACQUISITION"),
    title: text("title").notNull(),
    description: text("description"),
    industry: text("industry"),
    naicsCode: text("naics_code"),
    city: text("city"),
    state: text("state"),
    metro: text("metro"),
    askingPrice: integer("asking_price"),
    revenue: integer("revenue"),
    cashFlow: integer("cash_flow"), // as reported (usually SDE)
    ebitda: integer("ebitda"),
    yearEstablished: integer("year_established"),
    employees: integer("employees"),
    sellerFinancing: boolean("seller_financing"),
    sellerFinancingNote: text("seller_financing_note"),
    ownerInvolvement: text("owner_involvement"),
    missingFields: text("missing_fields").array().notNull().default(sql`ARRAY[]::text[]`),
    fingerprint: text("fingerprint").notNull().unique(), // cross-source dedupe key
    listingStatus: listingStatus("listing_status").notNull().default("UNKNOWN"),
    researchStatus: researchStatus("research_status").notNull().default("NEW"),
    pipelineStatus: pipelineStatus("pipeline_status").notNull().default("NONE"),
    firstDiscoveredAt: timestamp("first_discovered_at", { mode: "date" }).notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opp_type_status_idx").on(t.type, t.listingStatus),
    index("opp_geo_idx").on(t.state, t.metro),
    index("opp_industry_idx").on(t.industry),
    index("opp_discovered_idx").on(t.firstDiscoveredAt),
    index("opp_price_idx").on(t.askingPrice),
  ],
);

export const listings = pgTable(
  "listing",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    url: text("url").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    askingPrice: integer("asking_price"),
    status: listingStatus("status").notNull().default("ACTIVE"),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("listing_source_url_uq").on(t.sourceId, t.url), index("listing_opp_idx").on(t.opportunityId)],
);

/** Change history: price changes, status changes, re-listings. */
export const dataRefreshes = pgTable(
  "data_refresh",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { mode: "date" }).notNull().defaultNow(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    jobId: text("job_id"),
  },
  (t) => [index("refresh_opp_idx").on(t.opportunityId, t.observedAt), index("refresh_field_idx").on(t.field, t.observedAt)],
);

export const financialStatements = pgTable(
  "financial_statement",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    periodLabel: text("period_label").notNull(),
    provenance: provenance("provenance").notNull(),
    revenue: integer("revenue"),
    grossProfit: integer("gross_profit"),
    sde: integer("sde"),
    ebitda: integer("ebitda"),
    ownerComp: integer("owner_comp"),
    payroll: integer("payroll"),
    rent: integer("rent"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("fin_stmt_opp_idx").on(t.opportunityId)],
);

export const financialAssumptions = pgTable(
  "financial_assumption",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("fin_assumption_user_name_uq").on(t.userId, t.name)],
);

export const financialScenarios = pgTable(
  "financial_scenario",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: scenarioKind("kind").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull(),
    computedAt: timestamp("computed_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scenario_uq").on(t.opportunityId, t.userId, t.kind)],
);

// ───────────────────────── Research ─────────────────────────

export const researchReports = pgTable(
  "research_report",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    jobId: text("job_id"),
    recommendation: recommendation("recommendation").notNull(),
    summary: text("summary").notNull(),
    sections: jsonb("sections").$type<Record<string, unknown>>().notNull(),
    auditFlags: text("audit_flags").array().notNull().default(sql`ARRAY[]::text[]`),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("report_opp_version_uq").on(t.opportunityId, t.version), index("report_created_idx").on(t.createdAt)],
);

export const researchCitations = pgTable(
  "research_citation",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => researchReports.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    citedText: text("cited_text"),
    section: text("section"),
    provenance: provenance("provenance").notNull(),
  },
  (t) => [index("citation_report_idx").on(t.reportId)],
);

export const opportunityScores = pgTable(
  "opportunity_score",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    total: integer("total").notNull(),
    attractiveness: integer("attractiveness").notNull(),
    feasibility: integer("feasibility").notNull(),
    confidence: integer("confidence").notNull(),
    fit: integer("fit").notNull(),
    breakdown: jsonb("breakdown").$type<unknown>().notNull(),
    weights: jsonb("weights").$type<Record<string, number>>().notNull(),
    computedAt: timestamp("computed_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("score_opp_user_uq").on(t.opportunityId, t.userId), index("score_user_total_idx").on(t.userId, t.total)],
);

/** Market data from official APIs (e.g. Census County Business Patterns). */
export const marketStats = pgTable(
  "market_stat",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    geography: text("geography").notNull(), // e.g. "CBSA:19100"
    geoLabel: text("geo_label").notNull(),
    naics: text("naics").notNull(),
    naicsLabel: text("naics_label").notNull(),
    year: integer("year").notNull(),
    establishments: integer("establishments"),
    employees: integer("employees"),
    annualPayrollThousands: integer("annual_payroll_thousands"),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("market_stat_uq").on(t.sourceId, t.geography, t.naics, t.year), index("market_stat_naics_idx").on(t.naics)],
);

// ───────────────────────── User workflow ─────────────────────────

export const watchlistItems = pgTable(
  "watchlist_item",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watch_uq").on(t.userId, t.opportunityId)],
);

export const userFeedback = pgTable(
  "user_feedback",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    kind: feedbackKind("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_uq").on(t.userId, t.opportunityId, t.kind)],
);

export const notes = pgTable(
  "note",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    dueAt: timestamp("due_at", { mode: "date" }), // set => follow-up task
    doneAt: timestamp("done_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("note_user_due_idx").on(t.userId, t.dueAt)],
);

export const notifications = pgTable(
  "notification",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notification_dedupe_uq").on(t.userId, t.dedupeKey)],
);

// ───────────────────────── Jobs, reports, delivery ─────────────────────────

export const researchJobs = pgTable(
  "research_job",
  {
    id: id(),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    idempotencyKey: text("idempotency_key").notNull().unique(), // e.g. daily:2026-10-16
    triggeredBy: text("triggered_by").notNull(), // "schedule" | userId
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    sourcesAttempted: integer("sources_attempted").notNull().default(0),
    sourcesSucceeded: integer("sources_succeeded").notNull().default(0),
    discovered: integer("discovered").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    researched: integer("researched").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [index("job_kind_created_idx").on(t.kind, t.createdAt)],
);

export const researchJobLogs = pgTable(
  "research_job_log",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    at: timestamp("at", { mode: "date" }).notNull().defaultNow(),
    level: text("level").notNull(), // info | warn | error
    message: text("message").notNull(),
    data: jsonb("data"),
  },
  (t) => [index("job_log_idx").on(t.jobId, t.at)],
);

/** Archive of generated daily reports (one per user per local date). */
export const dailyReports = pgTable(
  "daily_report",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportDate: text("report_date").notNull(), // YYYY-MM-DD in the user's timezone
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("daily_report_uq").on(t.userId, t.reportDate)],
);

export const emailDeliveries = pgTable(
  "email_delivery",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // daily | alert
    reportDate: text("report_date").notNull(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    status: deliveryStatus("status").notNull().default("PENDING"),
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { mode: "date" }),
  },
  // Prevents duplicate daily emails for the same user/date.
  (t) => [uniqueIndex("email_delivery_uq").on(t.userId, t.kind, t.reportDate)],
);

export const auditLogs = pgTable(
  "audit_log",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    meta: jsonb("meta"),
    at: timestamp("at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_user_idx").on(t.userId, t.at)],
);

// ───────────────────────── Relations ─────────────────────────

export const opportunityRelations = relations(opportunities, ({ many }) => ({
  listings: many(listings),
  statements: many(financialStatements),
  reports: many(researchReports),
  scores: many(opportunityScores),
  refreshes: many(dataRefreshes),
  notes: many(notes),
}));
export const listingRelations = relations(listings, ({ one }) => ({
  opportunity: one(opportunities, { fields: [listings.opportunityId], references: [opportunities.id] }),
  source: one(sources, { fields: [listings.sourceId], references: [sources.id] }),
}));
export const reportRelations = relations(researchReports, ({ one, many }) => ({
  opportunity: one(opportunities, { fields: [researchReports.opportunityId], references: [opportunities.id] }),
  citations: many(researchCitations),
}));
export const citationRelations = relations(researchCitations, ({ one }) => ({
  report: one(researchReports, { fields: [researchCitations.reportId], references: [researchReports.id] }),
}));
export const statementRelations = relations(financialStatements, ({ one }) => ({
  opportunity: one(opportunities, { fields: [financialStatements.opportunityId], references: [opportunities.id] }),
}));
export const scoreRelations = relations(opportunityScores, ({ one }) => ({
  opportunity: one(opportunities, { fields: [opportunityScores.opportunityId], references: [opportunities.id] }),
}));
export const refreshRelations = relations(dataRefreshes, ({ one }) => ({
  opportunity: one(opportunities, { fields: [dataRefreshes.opportunityId], references: [opportunities.id] }),
}));
export const noteRelations = relations(notes, ({ one }) => ({
  opportunity: one(opportunities, { fields: [notes.opportunityId], references: [opportunities.id] }),
}));
export const jobRelations = relations(researchJobs, ({ many }) => ({ logs: many(researchJobLogs) }));
export const jobLogRelations = relations(researchJobLogs, ({ one }) => ({
  job: one(researchJobs, { fields: [researchJobLogs.jobId], references: [researchJobs.id] }),
}));

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type Preference = typeof preferences.$inferSelect;
export type ResearchReport = typeof researchReports.$inferSelect;

/** Liveness record written by the background worker on start and every dispatch. */
export const workerHeartbeats = pgTable("worker_heartbeat", {
  id: text("id").primaryKey(), // one row per worker process name
  startedAt: timestamp("started_at", { mode: "date" }).notNull(),
  lastBeatAt: timestamp("last_beat_at", { mode: "date" }).notNull(),
  host: text("host"),
});
