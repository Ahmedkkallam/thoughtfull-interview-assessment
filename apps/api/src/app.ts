import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { availabilityRoutes } from "./availability/routes.ts";
import { authRoutes } from "./auth/routes.ts";
import { SESSION_COOKIE, findSessionUser } from "./auth/sessions.ts";
import type { Clock } from "./clock.ts";
import { createDb } from "./db/client.ts";
import { errorHandler } from "./errors.ts";
import { professionalRoutes } from "./professionals/routes.ts";

export type AppDeps = { pool: Pool; clock: Clock };

export function buildApp({ pool, clock }: AppDeps) {
  const app = Fastify();
  const db = createDb(pool);

  app.register(cookie);
  app.decorateRequest("user", null);
  // Identify the caller from the session cookie only; routes never take a user id from the client.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await findSessionUser(db, token, clock.now()) : null;
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } }),
  );

  app.get("/api/health", async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });
  authRoutes(app, { db, clock });
  availabilityRoutes(app, { db });
  professionalRoutes(app, { db, clock });

  return app;
}
