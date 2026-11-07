import Fastify from "fastify";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Clock } from "./clock.ts";
import { createDb } from "./db/client.ts";

export type AppDeps = { pool: Pool; clock: Clock };

export function buildApp({ pool }: AppDeps) {
  const app = Fastify();
  const db = createDb(pool);

  app.get("/api/health", async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  return app;
}
