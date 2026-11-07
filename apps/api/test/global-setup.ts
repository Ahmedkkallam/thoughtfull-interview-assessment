import { runMigrations } from "../src/db/migrate.ts";
import { createTestPool } from "./db.ts";

// Start every run from an empty database, then apply the real migrations.
export default async function setup() {
  const pool = createTestPool();
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
