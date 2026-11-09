import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { availabilityRoutes } from "./availability/routes.ts";
import { authRoutes } from "./auth/routes.ts";
import { bookingSettingsRoutes } from "./booking-settings/routes.ts";
import { SESSION_COOKIE, findSessionUser } from "./auth/sessions.ts";
import type { Clock } from "./clock.ts";
import { createDb } from "./db/client.ts";
import { HttpError, errorHandler } from "./errors.ts";
import { notificationRoutes } from "./notifications/routes.ts";
import { professionalRoutes } from "./professionals/routes.ts";
import { sessionRoutes } from "./sessions/routes.ts";
import { timeOffRoutes } from "./time-off/routes.ts";

export type AppDeps = { pool: Pool; clock: Clock };

export function buildApp({ pool, clock }: AppDeps) {
  const app = Fastify();
  const db = createDb(pool);

  app.register(cookie);
  // global: false = no route is limited unless it asks (login does). Signup is deliberately not
  // limited: tests create many users from one IP, and a production limiter needs a proxy-aware IP.
  app.register(rateLimit, { global: false });
  // Second guard next to SameSite=Lax cookies: a browser-sent Origin from another site is refused.
  // No Origin (curl, tests) passes. Fastify also parses text/plain bodies, so this matters.
  app.addHook("onRequest", async (req) => {
    const origin = req.headers.origin;
    if (!origin || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
    let originHost: string | null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null; // e.g. "null" from a sandboxed page
    }
    if (originHost !== req.headers.host) {
      throw new HttpError(403, "FORBIDDEN_ORIGIN", "Request origin is not allowed");
    }
  });
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
  // Registered as a plugin so it loads after rateLimit (plain app.post calls run before queued plugins load).
  app.register(async (scope) => authRoutes(scope, { db, clock }));
  availabilityRoutes(app, { db });
  timeOffRoutes(app, { db, clock });
  bookingSettingsRoutes(app, { db });
  professionalRoutes(app, { db, clock });
  sessionRoutes(app, { db, clock });
  notificationRoutes(app, { db, clock });

  return app;
}
