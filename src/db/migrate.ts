import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import { seedSources } from "./seed-sources";

async function main() {
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Seeding source registry…");
  await seedSources(db);
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
