import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { Db } from "../db/client.ts";
import { authSessions, users } from "../db/schema.ts";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 7;

export type AuthUser = { id: string; role: "member" | "professional"; name: string; timezone: string; emailReminders: boolean };

// Only the hash is stored, so a copy of the table cannot be replayed as cookies.
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// Opaque random token (not a JWT) so logout can revoke it by deleting the row.
export async function startSession(db: Pick<Db, "insert">, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(authSessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return token;
}

// Returns the signed-in user, or null for an unknown or expired token.
// Expiry is compared with the app clock (not the database's now()) so tests can pin time.
export async function findSessionUser(db: Db, token: string, now: Date): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      name: users.name,
      timezone: users.timezone,
      emailReminders: users.emailReminders,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.tokenHash, hashToken(token)));
  if (!row || row.expiresAt <= now) return null;
  return { id: row.id, role: row.role, name: row.name, timezone: row.timezone, emailReminders: row.emailReminders };
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, // page scripts cannot read it
    sameSite: "lax", // not sent on cross-site POSTs (CSRF)
    secure: process.env.NODE_ENV === "production", // local dev runs on plain http
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
