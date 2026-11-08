import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { replaceWorkingHours } from "../src/availability/routes.ts";
import { createDb } from "../src/db/client.ts";
import { createTestPool } from "./db.ts";

const pool = createTestPool();
const app = buildApp({ pool, clock: { now: () => new Date("2027-01-10T12:00:00.000Z") } });
const db = createDb(pool);

const mira = { name: "Dr. Mira Okafor", email: "mira.okafor@example.test", password: "correct horse battery", role: "professional", timezone: "Europe/London" };
const ravi = { name: "Dr. Ravi Menon", email: "ravi.menon@example.test", password: "another good password", role: "professional", timezone: "America/New_York" };
const leo = { name: "Leo Tanaka", email: "leo.tanaka@example.test", password: "yet another password", role: "member", timezone: "Asia/Singapore" };

async function signup(body: object) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  return { id: res.json().id as string, token: res.cookies.find((c) => c.name === "session")!.value };
}
const get = (token: string) => app.inject({ method: "GET", url: "/api/availability", cookies: { session: token } });
const put = (token: string, hours: unknown) =>
  app.inject({ method: "PUT", url: "/api/availability", cookies: { session: token }, payload: { hours } });

beforeEach(async () => {
  await pool.query("TRUNCATE users, auth_sessions, working_hours CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("availability", () => {
  it("saves a week and reads it back sorted, as HH:mm", async () => {
    const { token } = await signup(mira);
    const week = [
      { weekday: 3, start: "10:00", end: "12:00" },
      { weekday: 1, start: "09:00", end: "17:00" },
    ];
    const res = await put(token, week);
    expect(res.statusCode).toBe(200);
    const sorted = [week[1], week[0]];
    expect(res.json()).toEqual(sorted);
    expect((await get(token)).json()).toEqual(sorted);
  });

  it("starts empty and accepts an empty week", async () => {
    const { token } = await signup(mira);
    expect((await get(token)).json()).toEqual([]);
    await put(token, [{ weekday: 1, start: "09:00", end: "10:00" }]);
    const res = await put(token, []);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect((await get(token)).json()).toEqual([]);
  });

  it("replaces the old ranges instead of adding to them", async () => {
    const { token } = await signup(mira);
    await put(token, [
      { weekday: 1, start: "09:00", end: "17:00" },
      { weekday: 2, start: "09:00", end: "17:00" },
    ]);
    await put(token, [{ weekday: 5, start: "08:00", end: "12:00" }]);
    expect((await get(token)).json()).toEqual([{ weekday: 5, start: "08:00", end: "12:00" }]);
  });

  it("accepts a split day and touching ranges", async () => {
    const { token } = await signup(mira);
    const week = [
      { weekday: 2, start: "09:00", end: "12:00" },
      { weekday: 2, start: "13:00", end: "17:00" },
      { weekday: 4, start: "09:00", end: "12:00" },
      { weekday: 4, start: "12:00", end: "13:00" },
    ];
    expect((await put(token, week)).statusCode).toBe(200);
    expect((await get(token)).json()).toEqual(week);
  });

  it.each([
    ["overlapping ranges", [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }]],
    ["end equal to start", [{ weekday: 1, start: "10:00", end: "10:00" }]],
    ["end before start", [{ weekday: 1, start: "11:00", end: "10:00" }]],
    ["crossing midnight", [{ weekday: 5, start: "22:00", end: "02:00" }]],
    ["weekday 8", [{ weekday: 8, start: "09:00", end: "10:00" }]],
    ["weekday 0", [{ weekday: 0, start: "09:00", end: "10:00" }]],
    ["a bad time format", [{ weekday: 1, start: "9am", end: "10:00" }]],
  ])("rejects %s and keeps the saved week", async (_name, bad) => {
    const { token } = await signup(mira);
    const saved = [{ weekday: 1, start: "09:00", end: "17:00" }];
    await put(token, saved);
    const res = await put(token, bad);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_HOURS");
    expect(res.json().error.message.length).toBeGreaterThan(0);
    expect((await get(token)).json()).toEqual(saved);
  });

  it("rejects a malformed body with a validation error", async () => {
    const { token } = await signup(mira);
    const res = await app.inject({
      method: "PUT",
      url: "/api/availability",
      cookies: { session: token },
      payload: { hours: "all day" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 to a member on both routes", async () => {
    const { token } = await signup(leo);
    expect((await get(token)).statusCode).toBe(403);
    expect((await put(token, [])).statusCode).toBe(403);
  });

  it("returns 401 to someone not signed in", async () => {
    expect((await app.inject({ method: "GET", url: "/api/availability" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/availability", payload: { hours: [] } })).statusCode).toBe(401);
  });

  it("never shows or changes another professional's hours", async () => {
    const a = await signup(mira);
    const b = await signup(ravi);
    const bWeek = [{ weekday: 2, start: "10:00", end: "15:00" }];
    await put(b.token, bWeek);

    expect((await get(a.token)).json()).toEqual([]);

    // A professional id sent in the body or query is ignored.
    await app.inject({
      method: "PUT",
      url: `/api/availability?professionalId=${b.id}`,
      cookies: { session: a.token },
      payload: { professionalId: b.id, hours: [{ weekday: 6, start: "09:00", end: "10:00" }] },
    });
    expect((await get(b.token)).json()).toEqual(bWeek);
    expect((await get(a.token)).json()).toEqual([{ weekday: 6, start: "09:00", end: "10:00" }]);

    await put(a.token, []);
    expect((await get(b.token)).json()).toEqual(bWeek);
  });

  it("a failing insert rolls back the delete, so the previous week stays", async () => {
    const { id, token } = await signup(mira);
    const saved = [{ weekday: 1, start: "09:00", end: "17:00" }];
    await put(token, saved);
    // Bypass validation: two ranges with the same weekday and start break the unique constraint.
    await expect(
      replaceWorkingHours(db, id, [
        { weekday: 2, start: "09:00", end: "10:00" },
        { weekday: 2, start: "09:00", end: "11:00" },
      ]),
    ).rejects.toThrow();
    expect((await get(token)).json()).toEqual(saved);
  });
});
