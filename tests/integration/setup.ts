import { beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db";
import { seedSources } from "@/db/seed-sources";

let migrated = false;
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("test")) throw new Error("Refusing to run integration tests against a non-test database");
  if (!migrated) {
    await migrate(db, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
});

beforeEach(async () => {
  await db.execute(sql`truncate table
    "user", opportunity, listing, data_refresh, financial_statement, research_report, research_citation,
    opportunity_score, financial_scenario, research_job, research_job_log, daily_report, email_delivery,
    notification, watchlist_item, user_feedback, note, source_record, market_stat, audit_log cascade`);
  await seedSources(db);
});
