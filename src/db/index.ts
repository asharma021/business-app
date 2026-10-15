import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// pg.Pool connects lazily on first query, so constructing it at import time is
// safe during `next build`. Cached on globalThis to survive dev hot-reloads.
const globalForDb = globalThis as unknown as { radarPool?: Pool };
const pool = (globalForDb.radarPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

export const db = drizzle({ client: pool, schema });
export { schema, pool };
export type DB = typeof db;
