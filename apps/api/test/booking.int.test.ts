import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTestPool } from "./db.ts";

// The database rejects past starts with its own now(), so these tests run on real time.
// The app clock can be shifted to simulate a skewed server or to let sessions end.
const HOUR = 3600_000;
let offsetMs = 0;
const pool = createTestPool();
const app = buildApp({ pool, clock: { now: () => new Date(Date.now() + offsetMs) } });

type Slot = { startsAt: string; endsAt: string };
type User = { id: string; token: string };

// UTC hours on every day, so there are always slots near the current time.
const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "23:00" }));

let seq = 0;
async function signup(name: string, role: "member" | "professional", timezone: string): Promise<User> {
  const email = `user${++seq}@example.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { name, email, password: "a long enough password", role, timezone },
  });
  return { id: res.json().id, token: res.cookies.find((c) => c.name === "session")!.value };
}

async function professional(name = "Dr. Mira Okafor"): Promise<User> {
  const pro = await signup(name, "professional", "UTC");
  const res = await app.inject({
    method: "PUT",
    url: "/api/availability",
    cookies: { session: pro.token },
    payload: { hours: everyDay },
  });
  expect(res.statusCode).toBe(200);
  return pro;
}

const member = (name = "Leo Tanaka") => signup(name, "member", "Asia/Singapore");

async function slotsOf(who: User, pro: User): Promise<Slot[]> {
  const res = await app.inject({ method: "GET", url: `/api/professionals/${pro.id}/slots`, cookies: { session: who.token } });
  return res.json().slots;
}

// A free slot at least `hoursAhead` from now, far enough that it cannot become past mid-test.
async function slotAhead(who: User, pro: User, hoursAhead = 2): Promise<Slot> {
  const slots = await slotsOf(who, pro);
  return slots.find((s) => new Date(s.startsAt).getTime() >= Date.now() + hoursAhead * HOUR)!;
}

const book = (who: User, body: object) =>
  app.inject({ method: "POST", url: "/api/sessions", cookies: { session: who.token }, payload: body });

const mySessions = (who: User, scope?: string) =>
  app.inject({ method: "GET", url: `/api/sessions${scope ? `?scope=${scope}` : ""}`, cookies: { session: who.token } });

// The top of the current UTC hour: always on the slot grid of an every-day 00:00-23:00 schedule.
const thisHour = () => Math.floor(Date.now() / HOUR) * HOUR;

beforeEach(async () => {
  offsetMs = 0;
  await pool.query("TRUNCATE users, auth_sessions, working_hours, sessions CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("booking a session", () => {
  it("books a free slot and returns the session with the professional's public profile", async () => {
    const pro = await professional();
    const leo = await member();
    const slot = await slotAhead(leo, pro);
    const res = await book(leo, { professionalId: pro.id, startsAt: slot.startsAt });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: expect.any(String),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: "booked",
      professional: { id: pro.id, name: "Dr. Mira Okafor", timezone: "UTC" },
    });
  });

  it("computes the end on the server: 50 minutes after the start, whatever the client sends", async () => {
    const pro = await professional();
    const leo = await member();
    const slot = await slotAhead(leo, pro);
    const endsAt = new Date(new Date(slot.startsAt).getTime() + 5 * HOUR).toISOString();
    const res = await book(leo, { professionalId: pro.id, startsAt: slot.startsAt, endsAt });
    expect(res.json().endsAt).toBe(new Date(new Date(slot.startsAt).getTime() + 50 * 60_000).toISOString());
  });

  it("removes a booked slot from the free list for other members and for the same member", async () => {
    const pro = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const slot = await slotAhead(leo, pro);
    expect((await book(leo, { professionalId: pro.id, startsAt: slot.startsAt })).statusCode).toBe(201);
    for (const who of [leo, ana]) {
      expect((await slotsOf(who, pro)).map((s) => s.startsAt)).not.toContain(slot.startsAt);
    }
  });

  it("hides the member's own booked time in another professional's free list", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const leo = await member();
    const slot = await slotAhead(leo, mira);
    await book(leo, { professionalId: mira.id, startsAt: slot.startsAt });
    expect((await slotsOf(leo, ravi)).map((s) => s.startsAt)).not.toContain(slot.startsAt);
    const ana = await member("Ana Silva");
    expect((await slotsOf(ana, ravi)).map((s) => s.startsAt)).toContain(slot.startsAt);
  });

  it("books the same time again once the earlier session is cancelled", async () => {
    const pro = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const slot = await slotAhead(leo, pro);
    const first = await book(leo, { professionalId: pro.id, startsAt: slot.startsAt });
    await pool.query(
      "UPDATE sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'member' WHERE id = $1",
      [first.json().id, leo.id],
    );
    expect((await slotsOf(ana, pro)).map((s) => s.startsAt)).toContain(slot.startsAt);
    expect((await book(ana, { professionalId: pro.id, startsAt: slot.startsAt })).statusCode).toBe(201);
  });
});

describe("double-booking under concurrent requests", () => {
  it("lets exactly one of ten members book the same slot at the same moment", async () => {
    const pro = await professional();
    const members = await Promise.all(Array.from({ length: 10 }, (_, i) => member(`Member ${i + 1}`)));
    const slot = await slotAhead(members[0]!, pro);

    // All ten requests are in flight together; the database decides who wins.
    const results = await Promise.all(members.map((m) => book(m, { professionalId: pro.id, startsAt: slot.startsAt })));

    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    for (const r of results.filter((r) => r.statusCode === 409)) expect(r.json().error.code).toBe("SLOT_TAKEN");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM sessions WHERE professional_id = $1", [pro.id]);
    expect(rows[0].n).toBe(1);
  });

  it("does not let a member hold two overlapping sessions with different professionals", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const leo = await member();
    const slot = await slotAhead(leo, mira);

    const results = await Promise.all(
      [mira, ravi].map((pro) => book(leo, { professionalId: pro.id, startsAt: slot.startsAt })),
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("MEMBER_OVERLAP");
  });

  it("lets a session start exactly when the previous one ends", async () => {
    const pro = await professional();
    const leo = await member();
    // Ranges are half-open [start, end), so touching sessions do not overlap.
    await pool.query(
      `INSERT INTO sessions (professional_id, member_id, starts_at, ends_at)
       SELECT $1, $2, t, t + interval '50 minutes'
       FROM unnest(ARRAY[now() + interval '1 day', now() + interval '1 day 50 minutes']) AS t`,
      [pro.id, leo.id],
    );
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM sessions");
    expect(rows[0].n).toBe(2);
  });
});

describe("rejecting times that are not free slots", () => {
  async function setup() {
    const pro = await professional();
    return { pro, leo: await member() };
  }

  it.each([
    ["a start off the hour grid", () => thisHour() + 26 * HOUR + 30 * 60_000],
    ["a start that has already passed", () => thisHour() - HOUR],
    ["the slot that began at the top of this hour", () => thisHour()],
    ["a start beyond the next 28 days", () => thisHour() + 29 * 24 * HOUR],
    ["a start outside working hours", () => Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR + 2 * 24 * HOUR + 23 * HOUR],
  ])("answers 422 for %s", async (_name, startMs) => {
    const { pro, leo } = await setup();
    const res = await book(leo, { professionalId: pro.id, startsAt: new Date(startMs()).toISOString() });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SLOT_NOT_AVAILABLE");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM sessions");
    expect(rows[0].n).toBe(0);
  });

  it("answers 404 for an unknown professional, a member's id and a malformed id", async () => {
    const { pro, leo } = await setup();
    const startsAt = (await slotAhead(leo, pro)).startsAt;
    for (const professionalId of ["00000000-0000-4000-8000-000000000000", leo.id, "not-a-uuid"]) {
      const res = await book(leo, { professionalId, startsAt });
      expect(res.statusCode).toBe(404);
    }
  });

  it("answers 400 for a body without a valid start time", async () => {
    const { pro, leo } = await setup();
    for (const startsAt of [undefined, "tomorrow", 12345]) {
      expect((await book(leo, { professionalId: pro.id, startsAt })).statusCode).toBe(400);
    }
  });
});

describe("the database rejects past starts on its own clock", () => {
  it("returns 422 when a skewed app clock lets a past slot through", async () => {
    const pro = await professional();
    const leo = await member();
    // The app believes it is three hours earlier, so a slot that already started still looks free to it.
    offsetMs = -3 * HOUR;
    const startsAt = (await slotsOf(leo, pro)).filter((s) => new Date(s.startsAt).getTime() < Date.now()).at(-1)!.startsAt;
    const res = await book(leo, { professionalId: pro.id, startsAt });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PAST_SLOT");
  });

  it("refuses a direct insert of a past session, bypassing the app entirely", async () => {
    const pro = await professional();
    const leo = await member();
    const insert = pool.query(
      `INSERT INTO sessions (professional_id, member_id, starts_at, ends_at)
       VALUES ($1, $2, now() - interval '1 hour', now() - interval '10 minutes')`,
      [pro.id, leo.id],
    );
    await expect(insert).rejects.toMatchObject({ code: "23514", constraint: "sessions_not_in_past" });
  });

  it("keeps both overlap constraints and the past-start trigger in the schema", async () => {
    const constraints = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'sessions'::regclass AND contype = 'x' ORDER BY conname",
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "sessions_no_member_overlap",
      "sessions_no_professional_overlap",
    ]);
    const triggers = await pool.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'sessions'::regclass AND NOT tgisinternal",
    );
    expect(triggers.rows.map((r) => r.tgname)).toEqual(["sessions_not_in_past"]);
  });
});

describe("my sessions", () => {
  it("shows a member only their own sessions, with the professional's name", async () => {
    const pro = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const slots = await slotsOf(leo, pro);
    const [a, b] = slots.filter((s) => new Date(s.startsAt).getTime() >= Date.now() + 2 * HOUR);
    await book(leo, { professionalId: pro.id, startsAt: a!.startsAt });
    await book(ana, { professionalId: pro.id, startsAt: b!.startsAt });

    const res = await mySessions(leo);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: expect.any(String),
        startsAt: a!.startsAt,
        endsAt: a!.endsAt,
        status: "booked",
        cancelReason: null,
        counterpart: { id: pro.id, name: "Dr. Mira Okafor", timezone: "UTC" },
      },
    ]);
  });

  it("shows a professional their own schedule with member names and no emails", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const leo = await member();
    const ana = await member("Ana Silva");
    const slots = (await slotsOf(leo, mira)).filter((s) => new Date(s.startsAt).getTime() >= Date.now() + 2 * HOUR);
    await book(ana, { professionalId: mira.id, startsAt: slots[1]!.startsAt });
    await book(leo, { professionalId: mira.id, startsAt: slots[0]!.startsAt });
    await book(leo, { professionalId: ravi.id, startsAt: slots[2]!.startsAt });

    const res = await mySessions(mira, "upcoming");
    expect(res.statusCode).toBe(200);
    // Sorted soonest first.
    expect(res.json().map((s: { counterpart: { name: string } }) => s.counterpart.name)).toEqual(["Leo Tanaka", "Ana Silva"]);
    expect(res.json()[0].counterpart).toEqual({ id: leo.id, name: "Leo Tanaka", timezone: "Asia/Singapore" });
    expect(res.body).not.toContain("@example.test");
  });

  it("moves a session to past once it has ended, newest first, and keeps cancelled ones there", async () => {
    const pro = await professional();
    const leo = await member();
    const slots = (await slotsOf(leo, pro)).filter((s) => new Date(s.startsAt).getTime() >= Date.now() + 2 * HOUR);
    const early = (await book(leo, { professionalId: pro.id, startsAt: slots[0]!.startsAt })).json();
    const later = (await book(leo, { professionalId: pro.id, startsAt: slots[1]!.startsAt })).json();
    const cancelled = (await book(leo, { professionalId: pro.id, startsAt: slots[10]!.startsAt })).json();
    await pool.query(
      "UPDATE sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'professional' WHERE id = $1",
      [cancelled.id, pro.id],
    );

    // A cancelled session is past straight away; the booked ones are still upcoming.
    expect((await mySessions(leo, "upcoming")).json().map((s: { id: string }) => s.id)).toEqual([early.id, later.id]);
    expect((await mySessions(leo, "past")).json()).toMatchObject([
      { id: cancelled.id, status: "cancelled", cancelReason: "professional" },
    ]);

    // A day later both booked sessions have ended.
    offsetMs = 24 * HOUR;
    expect((await mySessions(leo, "upcoming")).json()).toEqual([]);
    expect((await mySessions(leo, "past")).json().map((s: { id: string }) => s.id)).toEqual([
      cancelled.id,
      later.id,
      early.id,
    ]);
  });

  it("keeps a session in upcoming until it ends, not just until it starts", async () => {
    const pro = await professional();
    const leo = await member();
    const slot = await slotAhead(leo, pro);
    await book(leo, { professionalId: pro.id, startsAt: slot.startsAt });
    offsetMs = new Date(slot.startsAt).getTime() + 10 * 60_000 - Date.now();
    expect((await mySessions(leo, "upcoming")).json()).toHaveLength(1);
    offsetMs = new Date(slot.endsAt).getTime() - Date.now();
    expect((await mySessions(leo, "upcoming")).json()).toHaveLength(0);
    expect((await mySessions(leo, "past")).json()).toHaveLength(1);
  });

  it("hides the old row of a rescheduled session from past", async () => {
    const pro = await professional();
    const leo = await member();
    const slot = await slotAhead(leo, pro);
    const s = (await book(leo, { professionalId: pro.id, startsAt: slot.startsAt })).json();
    await pool.query(
      "UPDATE sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'rescheduled' WHERE id = $1",
      [s.id, leo.id],
    );
    expect((await mySessions(leo, "past")).json()).toEqual([]);
    expect((await mySessions(leo, "upcoming")).json()).toEqual([]);
  });

  it("keeps a booked session after the professional changes their working hours", async () => {
    const pro = await professional();
    const leo = await member();
    const slot = await slotAhead(leo, pro);
    await book(leo, { professionalId: pro.id, startsAt: slot.startsAt });
    const cleared = await app.inject({
      method: "PUT",
      url: "/api/availability",
      cookies: { session: pro.token },
      payload: { hours: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect((await mySessions(leo)).json()).toHaveLength(1);
    expect((await mySessions(pro)).json()).toHaveLength(1);
  });

  it("answers 400 for an unknown scope", async () => {
    const leo = await member();
    expect((await mySessions(leo, "everything")).statusCode).toBe(400);
  });
});

describe("access to sessions", () => {
  it("does not let a professional book", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const slot = await slotAhead(await member(), mira);
    const res = await book(ravi, { professionalId: mira.id, startsAt: slot.startsAt });
    expect(res.statusCode).toBe(403);
  });

  it("answers 401 to someone not signed in", async () => {
    for (const res of [
      await app.inject({ method: "GET", url: "/api/sessions" }),
      await app.inject({ method: "POST", url: "/api/sessions", payload: {} }),
    ]) {
      expect(res.statusCode).toBe(401);
    }
  });

  it("books for the signed-in member even when the body names someone else", async () => {
    const pro = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const slot = await slotAhead(leo, pro);
    const res = await book(leo, { professionalId: pro.id, startsAt: slot.startsAt, memberId: ana.id, member_id: ana.id });
    expect(res.statusCode).toBe(201);
    const { rows } = await pool.query("SELECT member_id FROM sessions WHERE id = $1", [res.json().id]);
    expect(rows[0].member_id).toBe(leo.id);
    expect((await mySessions(ana)).json()).toEqual([]);
  });
});
