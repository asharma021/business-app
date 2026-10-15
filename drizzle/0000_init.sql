CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('INTERESTED', 'NOT_INTERESTED', 'TOO_EXPENSIVE', 'TOO_RISKY', 'TOO_MUCH_WORK', 'ATTRACTIVE_CASH_FLOW', 'WORTH_INVESTIGATING', 'CONTACTED_SELLER');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('DAILY_RESEARCH', 'MANUAL_RESEARCH', 'OPPORTUNITY_RESEARCH', 'MARKET_DATA');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('ACTIVE', 'UNDER_CONTRACT', 'OFF_MARKET', 'ARCHIVED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('ACQUISITION', 'FRANCHISE', 'EMERGING');--> statement-breakpoint
CREATE TYPE "public"."ownership_preference" AS ENUM('OWNER_OPERATED', 'SEMI_ABSENTEE', 'EITHER');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('NONE', 'CONTACTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('VERIFIED', 'SELLER_REPORTED', 'THIRD_PARTY', 'AI_ESTIMATE');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('STRONG_CANDIDATE', 'PROMISING_NEEDS_VERIFICATION', 'HIGH_RISK', 'FINANCIALLY_UNATTRACTIVE', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('NEW', 'QUEUED', 'RESEARCHING', 'RESEARCHED', 'NEEDS_INFO', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."risk_tolerance" AS ENUM('LOW', 'MODERATE', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."scenario_kind" AS ENUM('CONSERVATIVE', 'BASE', 'OPTIMISTIC', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."source_access" AS ENUM('CONFIRMED', 'PROPOSED', 'MANUAL_ONLY', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('API', 'RSS', 'WEB_SEARCH', 'MANUAL_URL', 'DOCUMENT');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"meta" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"report_date" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_refresh" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"report_date" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"provider_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "financial_assumption" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "scenario_kind" NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_statement" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"source_record_id" text,
	"period_label" text NOT NULL,
	"provenance" "provenance" NOT NULL,
	"revenue" integer,
	"gross_profit" integer,
	"sde" integer,
	"ebitda" integer,
	"owner_comp" integer,
	"payroll" integer,
	"rent" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_record_id" text,
	"url" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"asking_price" integer,
	"status" "listing_status" DEFAULT 'ACTIVE' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_stat" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"geography" text NOT NULL,
	"geo_label" text NOT NULL,
	"naics" text NOT NULL,
	"naics_label" text NOT NULL,
	"year" integer NOT NULL,
	"establishments" integer,
	"employees" integer,
	"annual_payroll_thousands" integer,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"body" text NOT NULL,
	"due_at" timestamp,
	"done_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "opportunity_type" DEFAULT 'ACQUISITION' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"industry" text,
	"naics_code" text,
	"city" text,
	"state" text,
	"metro" text,
	"asking_price" integer,
	"revenue" integer,
	"cash_flow" integer,
	"ebitda" integer,
	"year_established" integer,
	"employees" integer,
	"seller_financing" boolean,
	"seller_financing_note" text,
	"owner_involvement" text,
	"missing_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"fingerprint" text NOT NULL,
	"listing_status" "listing_status" DEFAULT 'UNKNOWN' NOT NULL,
	"research_status" "research_status" DEFAULT 'NEW' NOT NULL,
	"pipeline_status" "pipeline_status" DEFAULT 'NONE' NOT NULL,
	"first_discovered_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "opportunity_score" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"total" integer NOT NULL,
	"attractiveness" integer NOT NULL,
	"feasibility" integer NOT NULL,
	"confidence" integer NOT NULL,
	"fit" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_owner_income" integer DEFAULT 150000 NOT NULL,
	"min_owner_income" integer DEFAULT 100000 NOT NULL,
	"stretch_owner_income" integer DEFAULT 250000 NOT NULL,
	"capital_budget" integer,
	"max_asking_price" integer,
	"risk_tolerance" "risk_tolerance" DEFAULT 'MODERATE' NOT NULL,
	"ownership_preference" "ownership_preference" DEFAULT 'OWNER_OPERATED' NOT NULL,
	"primary_states" text[] DEFAULT ARRAY['TX']::text[] NOT NULL,
	"primary_metros" text[] DEFAULT ARRAY['Dallas-Fort Worth']::text[] NOT NULL,
	"include_nationwide" boolean DEFAULT true NOT NULL,
	"excluded_industries" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"scoring_weights" jsonb,
	"financing_defaults" jsonb,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"daily_report_hour" integer DEFAULT 7 NOT NULL,
	"daily_report_minute" integer DEFAULT 0 NOT NULL,
	"daily_email_enabled" boolean DEFAULT true NOT NULL,
	"report_email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "research_citation" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"cited_text" text,
	"section" text,
	"provenance" "provenance" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_job_log" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "research_job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"triggered_by" text NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"sources_attempted" integer DEFAULT 0 NOT NULL,
	"sources_succeeded" integer DEFAULT 0 NOT NULL,
	"discovered" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"researched" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_job_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "research_report" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"version" integer NOT NULL,
	"job_id" text,
	"recommendation" "recommendation" NOT NULL,
	"summary" text NOT NULL,
	"sections" jsonb NOT NULL,
	"audit_flags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"http_status" integer,
	"robots_allowed" boolean,
	"content_hash" text NOT NULL,
	"content_type" text,
	"excerpt" text
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"access" "source_access" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reliability" integer DEFAULT 50 NOT NULL,
	"homepage" text,
	"terms_note" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "watchlist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_refresh" ADD CONSTRAINT "data_refresh_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assumption" ADD CONSTRAINT "financial_assumption_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_scenario" ADD CONSTRAINT "financial_scenario_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_scenario" ADD CONSTRAINT "financial_scenario_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statement" ADD CONSTRAINT "financial_statement_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statement" ADD CONSTRAINT "financial_statement_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_stat" ADD CONSTRAINT "market_stat_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_score" ADD CONSTRAINT "opportunity_score_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_score" ADD CONSTRAINT "opportunity_score_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference" ADD CONSTRAINT "preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_citation" ADD CONSTRAINT "research_citation_report_id_research_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."research_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_log" ADD CONSTRAINT "research_job_log_job_id_research_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_report" ADD CONSTRAINT "research_report_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_report_uq" ON "daily_report" USING btree ("user_id","report_date");--> statement-breakpoint
CREATE INDEX "refresh_opp_idx" ON "data_refresh" USING btree ("opportunity_id","observed_at");--> statement-breakpoint
CREATE INDEX "refresh_field_idx" ON "data_refresh" USING btree ("field","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_uq" ON "email_delivery" USING btree ("user_id","kind","report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_assumption_user_name_uq" ON "financial_assumption" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_uq" ON "financial_scenario" USING btree ("opportunity_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "fin_stmt_opp_idx" ON "financial_statement" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_source_url_uq" ON "listing" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "listing_opp_idx" ON "listing" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_stat_uq" ON "market_stat" USING btree ("source_id","geography","naics","year");--> statement-breakpoint
CREATE INDEX "market_stat_naics_idx" ON "market_stat" USING btree ("naics");--> statement-breakpoint
CREATE INDEX "note_user_due_idx" ON "note" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uq" ON "notification" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "opp_type_status_idx" ON "opportunity" USING btree ("type","listing_status");--> statement-breakpoint
CREATE INDEX "opp_geo_idx" ON "opportunity" USING btree ("state","metro");--> statement-breakpoint
CREATE INDEX "opp_industry_idx" ON "opportunity" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "opp_discovered_idx" ON "opportunity" USING btree ("first_discovered_at");--> statement-breakpoint
CREATE INDEX "opp_price_idx" ON "opportunity" USING btree ("asking_price");--> statement-breakpoint
CREATE UNIQUE INDEX "score_opp_user_uq" ON "opportunity_score" USING btree ("opportunity_id","user_id");--> statement-breakpoint
CREATE INDEX "score_user_total_idx" ON "opportunity_score" USING btree ("user_id","total");--> statement-breakpoint
CREATE INDEX "citation_report_idx" ON "research_citation" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "job_log_idx" ON "research_job_log" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX "job_kind_created_idx" ON "research_job" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_opp_version_uq" ON "research_report" USING btree ("opportunity_id","version");--> statement-breakpoint
CREATE INDEX "report_created_idx" ON "research_report" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "source_record_source_idx" ON "source_record" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "source_record_hash_idx" ON "source_record" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_uq" ON "user_feedback" USING btree ("user_id","opportunity_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_uq" ON "watchlist_item" USING btree ("user_id","opportunity_id");