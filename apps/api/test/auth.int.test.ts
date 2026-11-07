import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { requireRole } from "../src/auth/guards.ts";
import type { Clock } from "../src/clock.ts";
import { createTestPool } from "./db.ts";

const pool = createTestPool();
// A clock the tests can move; the app reads "now" only from here.
let now = new Date("2027-01-10T12:00:00.000Z");
const clock: Clock = { now: () => now };
const app = buildApp({ pool, clock });
// Tiny routes so the role guard can be tested without real feature routes.
app.get("/api/test/members-only", { preHandler: requireRole("member") }, async () => ({ ok: true }));
app.get("/api/test/professionals-only", { preHandler: requireRole("professional") }, async () => ({ ok: true }));
app.get("/api/test/crash", async () => {
  throw new Error("select * from users -- internal detail");
});

const DAY_MS = 24 * 60 * 60 * 1000;

const mira = {
  name: "Dr. Mira Okafor",
  email: "mira.okafor@example.test",
  password: "correct horse battery",
  role: "professional",
  timezone: "Europe/London",
};
const leo = {
  name: "Leo Tanaka",
  email: "leo.tanaka@example.test",
  password: "another good password",
  role: "member",
  timezone: "Asia/Singapore",
};

async function signup(body: object) {
  return app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
}

function sessionCookie(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((c) => c.name === "session");
  if (!c) throw new Error("no session cookie set");
  return c.value;
}

function me(token: string) {
  return app.inject({ method: "GET", url: "/api/me", cookies: { session: token } });
}

beforeEach(async () => {
  now = new Date("2027-01-10T12:00:00.000Z");
  await pool.query("TRUNCATE users, auth_sessions CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("sign up", () => {
  it("creates the account, sets an httpOnly session cookie, and /me returns the user", async () => {
    const res = await signup(mira);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ id: expect.any(String), name: mira.name, role: "professional", timezone: "Europe/London" });

    const cookie = res.cookies.find((c) => c.name === "session")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

    const meRes = await me(cookie.value);
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toEqual(body);
  });

  it("rejects an email already used by another account, even in different case", async () => {
    expect((await signup(mira)).statusCode).toBe(201);
    const res = await signup({ ...leo, email: mira.email.toUpperCase() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "EMAIL_TAKEN", message: expect.any(String) } });
  });

  it.each(["Mars/Olympus", "+05:00", "UTC+5", ""])("rejects %j as a timezone", async (timezone) => {
    const res = await signup({ ...leo, timezone });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["UTC", "Asia/Kolkata", "America/New_York"])("accepts %j as a timezone", async (timezone) => {
    const res = await signup({ ...leo, timezone });
    expect(res.statusCode).toBe(201);
    expect(res.json().timezone).toBe(timezone);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await signup({ ...leo, password: "short12" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores a user id sent in the body", async () => {
    const forgedId = "00000000-0000-4000-8000-000000000001";
    const res = await signup({ ...leo, id: forgedId, userId: forgedId });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe(forgedId);
    const { rows } = await pool.query("select id from users");
    expect(rows.map((r) => r.id)).not.toContain(forgedId);
  });

  it("stores the password as a salted scrypt hash, never in plain text", async () => {
    await signup(mira);
    await signup({ ...leo, password: mira.password });
    const { rows } = await pool.query<{ password_hash: string }>("select password_hash from users");
    for (const { password_hash } of rows) {
      expect(password_hash).not.toContain(mira.password);
      expect(password_hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    }
    // Same password, different salt: the hashes differ.
    expect(rows[0]!.password_hash).not.toBe(rows[1]!.password_hash);
  });

  it("stores only the sha256 of the session token", async () => {
    const token = sessionCookie(await signup(mira));
    const { rows } = await pool.query<{ token_hash: Buffer }>("select token_hash from auth_sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.equals(createHash("sha256").update(token).digest())).toBe(true);
  });
});

describe("log in", () => {
  it("returns the user and a new session cookie for the right password, with any email case", async () => {
    await signup(mira);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: mira.email.toUpperCase(), password: mira.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: mira.name, role: "professional" });
    expect(res.json()).not.toHaveProperty("email");
    expect(res.json()).not.toHaveProperty("passwordHash");
    expect((await me(sessionCookie(res))).statusCode).toBe(200);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await signup(mira);
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: mira.email, password: "not the password" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.test", password: "not the password" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(wrongPassword.cookies).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("rejects a request without a session cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a made-up token", async () => {
    expect((await me("not-a-real-token")).statusCode).toBe(401);
  });

  it("logout revokes the token on the server, so the old cookie no longer works", async () => {
    const token = sessionCookie(await signup(mira));
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { session: token } });
    expect(res.statusCode).toBe(204);
    // The browser is told to drop the cookie...
    expect(res.cookies.find((c) => c.name === "session")?.value).toBe("");
    // ...and replaying the old cookie is refused.
    expect((await me(token)).statusCode).toBe(401);
  });

  it("logout of one session leaves the user's other sessions signed in", async () => {
    const first = sessionCookie(await signup(mira));
    const second = sessionCookie(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: mira.email, password: mira.password } }),
    );
    await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { session: first } });
    expect((await me(first)).statusCode).toBe(401);
    expect((await me(second)).statusCode).toBe(200);
  });

  it("a session works until just before 7 days and is refused from exactly 7 days", async () => {
    const start = now;
    const token = sessionCookie(await signup(mira));

    now = new Date(start.getTime() + 7 * DAY_MS - 1);
    expect((await me(token)).statusCode).toBe(200);

    now = new Date(start.getTime() + 7 * DAY_MS);
    expect((await me(token)).statusCode).toBe(401);

    now = new Date(start.getTime() + 7 * DAY_MS + 1);
    expect((await me(token)).statusCode).toBe(401);
  });

  it("identifies the caller from the cookie, not from a user id in the query", async () => {
    const miraBody = (await signup(mira)).json();
    const leoToken = sessionCookie(await signup(leo));
    const res = await app.inject({ method: "GET", url: `/api/me?userId=${miraBody.id}`, cookies: { session: leoToken } });
    expect(res.json().name).toBe(leo.name);
  });
});

describe("role guard", () => {
  it("lets each role through its own routes and returns 403 on the other role's", async () => {
    const proToken = sessionCookie(await signup(mira));
    const memberToken = sessionCookie(await signup(leo));
    const get = (url: string, token: string) => app.inject({ method: "GET", url, cookies: { session: token } });

    expect((await get("/api/test/professionals-only", proToken)).statusCode).toBe(200);
    expect((await get("/api/test/members-only", memberToken)).statusCode).toBe(200);

    const denied = await get("/api/test/members-only", proToken);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
    expect((await get("/api/test/professionals-only", memberToken)).statusCode).toBe(403);
  });

  it("returns 401, not 403, when nobody is signed in", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/members-only" });
    expect(res.statusCode).toBe(401);
  });
});

describe("errors", () => {
  it("hides internal details when something unexpected fails", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/crash" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });

  it("returns a JSON 404 for an unknown route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
});
