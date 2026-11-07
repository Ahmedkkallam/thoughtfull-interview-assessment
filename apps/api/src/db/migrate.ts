import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb } from "./client.ts";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder });
}

// Run as a script: `npm run db:migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url });
  try {
    await runMigrations(pool);
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}
