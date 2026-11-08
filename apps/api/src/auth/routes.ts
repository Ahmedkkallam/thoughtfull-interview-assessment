import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Clock } from "../clock.ts";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";
import { requireAuth } from "./guards.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { SESSION_COOKIE, clearSessionCookie, endSession, setSessionCookie, startSession, type AuthUser } from "./sessions.ts";
import { canonicalTimeZone, isValidTimeZone } from "./timezone.ts";

// z.object drops unknown keys, so a client-sent id or other extra field never reaches the database.
const signupBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(200),
  role: z.enum(["member", "professional"]),
  timezone: z.string().refine(isValidTimeZone, "Must be an IANA timezone name such as Europe/London"),
});

const loginBody = z.object({ email: z.string(), password: z.string() });

// Same error for an unknown email and a wrong password, so login does not reveal who has an account.
const invalidCredentials = () => new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

// The only user fields any auth response exposes.
const publicUser = { id: users.id, role: users.role, name: users.name, timezone: users.timezone };

export function authRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  app.post("/api/auth/signup", async (req, reply) => {
    const body = signupBody.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    // One transaction: never an account without its first session, or the reverse.
    const { user, token } = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: body.name,
          email: body.email,
          role: body.role,
          timezone: canonicalTimeZone(body.timezone),
          passwordHash,
        })
        .returning(publicUser);
      return { user: user!, token: await startSession(tx, user!.id, clock.now()) };
    });
    setSessionCookie(reply, token);
    return reply.status(201).send(user);
  });

  // 10 attempts per 15 minutes per IP + email: one account cannot be guessed endlessly.
  // Runs at preHandler (not the default onRequest) because the key needs the parsed body.
  const loginLimit = {
    max: 10,
    timeWindow: "15 minutes",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) => {
      const email = (req.body as { email?: unknown } | null)?.email;
      return `${req.ip}|${typeof email === "string" ? email.toLowerCase() : ""}`;
    },
    errorResponseBuilder: () =>
      new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many login attempts. Please wait a few minutes and try again."),
  };

  app.post("/api/auth/login", { config: { rateLimit: loginLimit } }, async (req, reply) => {
    const { email, password } = loginBody.parse(req.body);
    const [row] = await db
      .select({ ...publicUser, passwordHash: users.passwordHash })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    if (!row) {
      // Spend the same hashing time as a real check, so timing does not reveal unknown emails.
      await hashPassword(password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(password, row.passwordHash))) throw invalidCredentials();
    const token = await startSession(db, row.id, clock.now());
    setSessionCookie(reply, token);
    const user: AuthUser = { id: row.id, role: row.role, name: row.name, timezone: row.timezone };
    return user;
  });

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
    // Deleting the row is what logs out; clearing the cookie only tidies the browser.
    await endSession(db, req.cookies[SESSION_COOKIE]!);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req) => req.user);
}
