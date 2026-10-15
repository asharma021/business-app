import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
import { seedSources } from "./seed-sources";

// Session-level advisory lock so two services deploying at once can't run migrations concurrently.
const LOCK_ID = 727_401_001;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Waiting for migration lock…");
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    console.log("Running migrations…");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Seeding source registry…");
    await seedSources(db);
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from source`)).rows;
    console.log(`Done. ${n} sources registered.`);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
