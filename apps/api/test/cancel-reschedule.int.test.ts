import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDb } from "../src/db/client.ts";
import { deliverDueReminders } from "../src/reminders/deliver.ts";
import { createTestPool } from "./db.ts";

// Bookings run on real time (the database refuses past starts with its own clock). The app clock
// can then be pinned to any later moment, such as exactly 24 hours before a booked session.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TOO_LATE = "Sessions can't be cancelled or rescheduled less than 24 hours before they start.";
let pinned: Date | null = null;
const pool = createTestPool();
const db = createDb(pool);
const app = buildApp({ pool, clock: { now: () => pinned ?? new Date() } });

type Slot = { startsAt: string; endsAt: string };
type User = { id: string; token: string };
type Booked = { id: string; startsAt: string };

const allDay = (start = "00:00") => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start, end: "23:59" }));

let seq = 0;
async function signup(name: string, role: "member" | "professional", timezone: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { name, email: `change${++seq}@example.test`, password: "a long enough password", role, timezone },
  });
  return { id: res.json().id, token: res.cookies.find((c) => c.name === "session")!.value };
}

const setHours = (pro: User, hours: object[]) =>
  app.inject({ method: "PUT", url: "/api/availability", cookies: { session: pro.token }, payload: { hours } });

// Professional in London, member in Singapore: the rule is absolute hours, whatever the zones.
async function professional(name = "Dr. Mira Okafor"): Promise<User> {
  const pro = await signup(name, "professional", "Europe/London");
  expect((await setHours(pro, allDay())).statusCode).toBe(200);
  return pro;
}

const member = (name = "Leo Tanaka") => signup(name, "member", "Asia/Singapore");

// The free slots starting at least `hoursAhead` of real time from now, soonest first.
async function slotsAhead(who: User, pro: User, hoursAhead: number): Promise<Slot[]> {
  const res = await app.inject({ method: "GET", url: `/api/professionals/${pro.id}/slots`, cookies: { session: who.token } });
  return (res.json().slots as Slot[]).filter((s) => new Date(s.startsAt).getTime() >= Date.now() + hoursAhead * HOUR);
}

const book = (who: User, pro: User, startsAt: string) =>
  app.inject({ method: "POST", url: "/api/sessions", cookies: { session: who.token }, payload: { professionalId: pro.id, startsAt } });

async function bookAhead(who: User, pro: User, hoursAhead = 30): Promise<Booked> {
  const [slot] = await slotsAhead(who, pro, hoursAhead);
  const res = await book(who, pro, slot!.startsAt);
  expect(res.statusCode).toBe(201);
  return res.json();
}

const cancel = (who: User, id: string) =>
  app.inject({ method: "POST", url: `/api/sessions/${id}/cancel`, cookies: { session: who.token } });

const reschedule = (who: User, id: string, startsAt: string) =>
  app.inject({ method: "POST", url: `/api/sessions/${id}/reschedule`, cookies: { session: who.token }, payload: { startsAt } });

const at = (session: Booked, offsetMs: number) => new Date(new Date(session.startsAt).getTime() + offsetMs);
const shift = (iso: string, offsetMs: number) => new Date(new Date(iso).getTime() + offsetMs).toISOString();

async function sessionRow(id: string) {
  const { rows } = await pool.query(
    "SELECT status, cancel_reason, cancelled_by, rescheduled_from FROM sessions WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${sql}`, params);
  return rows[0].n;
}

const bookedOf = (who: User) => count("sessions WHERE member_id = $1 AND status = 'booked'", [who.id]);
const pendingReminders = (sessionId: string) =>
  count("reminders WHERE session_id = $1 AND delivered_at IS NULL AND cancelled_at IS NULL", [sessionId]);

const notificationsOf = async (who: User) =>
  (await app.inject({ method: "GET", url: "/api/notifications", cookies: { session: who.token } })).json() as {
    kind: string;
    session: { id: string };
  }[];

const listSessions = async (who: User, scope: "upcoming" | "past") =>
  (await app.inject({ method: "GET", url: `/api/sessions?scope=${scope}`, cookies: { session: who.token } })).json() as {
    id: string;
  }[];

beforeEach(async () => {
  pinned = null;
  await pool.query("TRUNCATE users, auth_sessions, working_hours, sessions, reminders, notifications CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("the 24-hour rule", () => {
  it("lets a member cancel exactly 24 hours before the start", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    pinned = at(s, -24 * HOUR);
    const res = await cancel(leo, s.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: s.id, status: "cancelled", cancelReason: "member" });
  });

  it("refuses a member's cancel 1 ms inside the 24 hours, with a clear message, and changes nothing", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    pinned = at(s, -24 * HOUR + 1);
    const res = await cancel(leo, s.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: "TOO_LATE", message: TOO_LATE });
    expect((await sessionRow(s.id)).status).toBe("booked");
    expect(await pendingReminders(s.id)).toBe(4);
  });

  it("lets a member reschedule exactly 24 hours before the start", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const s = (await book(leo, mira, first!.startsAt)).json();
    pinned = at(s, -24 * HOUR);
    expect((await reschedule(leo, s.id, later!.startsAt)).statusCode).toBe(201);
  });

  it("refuses a member's reschedule 1 ms inside the 24 hours and keeps the session", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const s = (await book(leo, mira, first!.startsAt)).json();
    pinned = at(s, -24 * HOUR + 1);
    const res = await reschedule(leo, s.id, later!.startsAt);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: "TOO_LATE", message: TOO_LATE });
    expect((await sessionRow(s.id)).status).toBe("booked");
    expect(await count("sessions")).toBe(1);
  });

  it("lets the professional cancel within the 24 hours", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    pinned = at(s, -HOUR);
    const res = await cancel(mira, s.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "cancelled", cancelReason: "professional" });
    expect((await sessionRow(s.id)).cancelled_by).toBe(mira.id);
  });

  it("lets nobody cancel or reschedule a session once it has started", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, later] = await slotsAhead(leo, mira, 30);
    const s = (await book(leo, mira, first!.startsAt)).json();
    for (const offset of [0, 10 * MINUTE]) {
      pinned = at(s, offset);
      for (const res of [await cancel(leo, s.id), await cancel(mira, s.id), await reschedule(leo, s.id, later!.startsAt)]) {
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("STARTED");
      }
    }
    expect((await sessionRow(s.id)).status).toBe("booked");
  });

  it("counts real hours across the London spring-forward, not the wall clock", async () => {
    // Pinned before sign-up so the login cookies are valid at that moment.
    pinned = new Date("2027-03-27T12:00:00.001Z");
    const mira = await signup("Dr. Mira Okafor", "professional", "Europe/London");
    const leo = await member();
    // 13:00 BST on Sunday 28 March 2027, the day the clocks go forward. Inserted directly: it is
    // beyond the 28-day booking window today, and cancelling does not depend on working hours.
    const { rows } = await pool.query(
      `INSERT INTO sessions (professional_id, member_id, starts_at, ends_at)
       VALUES ($1, $2, '2027-03-28T12:00:00Z', '2027-03-28T12:50:00Z') RETURNING id`,
      [mira.id, leo.id],
    );
    const id = rows[0].id;
    // London reads 12:00 GMT the day before: only 23 real hours remain, though the wall clock says 25.
    expect((await cancel(leo, id)).json().error.code).toBe("TOO_LATE");
    pinned = new Date("2027-03-27T12:00:00Z");
    expect((await cancel(leo, id)).statusCode).toBe(200);
  });
});

describe("cancelling a session", () => {
  it("frees the time so another member can book it", async () => {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const s = await bookAhead(leo, mira);
    expect((await cancel(leo, s.id)).statusCode).toBe(200);
    expect((await slotsAhead(ana, mira, 0)).map((x) => x.startsAt)).toContain(s.startsAt);
    expect((await book(ana, mira, s.startsAt)).statusCode).toBe(201);
  });

  it("marks every pending reminder cancelled, so none is ever delivered", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    expect((await cancel(mira, s.id)).statusCode).toBe(200);
    expect(await count("reminders WHERE session_id = $1 AND cancelled_at IS NOT NULL", [s.id])).toBe(4);
    expect(await deliverDueReminders(db, at(s, -30 * MINUTE))).toBe(0);
    expect(await count("notifications WHERE kind IN ('reminder_24h', 'reminder_1h')")).toBe(0);
  });

  it("keeps a reminder that was already delivered as delivered", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    await deliverDueReminders(db, at(s, -24 * HOUR + MINUTE));
    pinned = at(s, -24 * HOUR + 2 * MINUTE);
    expect((await cancel(mira, s.id)).statusCode).toBe(200);
    const { rows } = await pool.query(
      "SELECT kind, delivered_at IS NOT NULL AS delivered, cancelled_at IS NOT NULL AS cancelled FROM reminders WHERE session_id = $1",
      [s.id],
    );
    for (const r of rows) expect([r.kind, r.delivered, r.cancelled]).toEqual(r.kind === "24h" ? ["24h", true, false] : ["1h", false, true]);
  });

  it("tells the professional when the member cancels, and not the member", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    await cancel(leo, s.id);
    expect(await notificationsOf(mira)).toMatchObject([{ kind: "session_cancelled", session: { id: s.id } }]);
    expect(await notificationsOf(leo)).toEqual([]);
  });

  it("tells the member when the professional cancels, and not the professional", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    await cancel(mira, s.id);
    expect(await notificationsOf(leo)).toMatchObject([{ kind: "session_cancelled", session: { id: s.id } }]);
    expect(await notificationsOf(mira)).toEqual([]);
  });

  it("shows a cancelled session in past, and answers 409 to a second cancel", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    await cancel(leo, s.id);
    expect((await listSessions(leo, "past")).map((x) => x.id)).toEqual([s.id]);
    const again = await cancel(mira, s.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("NOT_ACTIVE");
    expect(await count("notifications")).toBe(1);
  });
});

describe("rescheduling a session", () => {
  it("replaces the old session with a new one and moves the reminders", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();

    const res = await reschedule(leo, old.id, later!.startsAt);
    expect(res.statusCode).toBe(201);
    const moved = res.json();
    expect(moved).toEqual({
      id: expect.any(String),
      startsAt: later!.startsAt,
      endsAt: later!.endsAt,
      status: "booked",
      professional: { id: mira.id, name: "Dr. Mira Okafor", timezone: "Europe/London" },
    });

    expect(await sessionRow(old.id)).toMatchObject({ status: "cancelled", cancel_reason: "rescheduled" });
    expect((await sessionRow(moved.id)).rescheduled_from).toBe(old.id);
    expect(await bookedOf(leo)).toBe(1);
    expect((await listSessions(leo, "upcoming")).map((x) => x.id)).toEqual([moved.id]);
    expect(await listSessions(leo, "past")).toEqual([]);

    expect(await pendingReminders(old.id)).toBe(0);
    expect(await pendingReminders(moved.id)).toBe(4);
    expect(await notificationsOf(mira)).toMatchObject([{ kind: "session_rescheduled", session: { id: moved.id } }]);
  });

  it("moves a session by 30 minutes, onto a time that overlaps the old one", async () => {
    const mira = await professional();
    const leo = await member();
    // An hour between 01:00 and 21:00 UTC is between 01:00 and 22:00 in London, summer or winter,
    // so 30 minutes later is still inside that day's hours.
    const slot = (await slotsAhead(leo, mira, 30)).find((x) => {
      const h = new Date(x.startsAt).getUTCHours();
      return h >= 1 && h <= 21;
    })!;
    const old = (await book(leo, mira, slot.startsAt)).json();
    // The professional's hours now start on the half hour, so the grid moves by 30 minutes.
    expect((await setHours(mira, allDay("00:30"))).statusCode).toBe(200);

    const res = await reschedule(leo, old.id, shift(slot.startsAt, 30 * MINUTE));
    expect(res.statusCode).toBe(201);
    expect(await bookedOf(leo)).toBe(1);
  });

  it("keeps the old session and its reminders when the new time is taken", async () => {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();
    expect((await book(ana, mira, later!.startsAt)).statusCode).toBe(201);

    const res = await reschedule(leo, old.id, later!.startsAt);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SLOT_TAKEN");
    expect((await sessionRow(old.id)).status).toBe("booked");
    expect(await pendingReminders(old.id)).toBe(4);
    expect(await bookedOf(leo)).toBe(1);
    expect(await notificationsOf(mira)).toEqual([]);
  });

  it("keeps the old session when the member has another session at the new time", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();
    expect((await book(leo, ravi, later!.startsAt)).statusCode).toBe(201);

    const res = await reschedule(leo, old.id, later!.startsAt);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MEMBER_OVERLAP");
    expect((await sessionRow(old.id)).status).toBe("booked");
    expect(await pendingReminders(old.id)).toBe(4);
  });

  it("answers 422 for a time that is not one of the professional's slots", async () => {
    const mira = await professional();
    const leo = await member();
    const old = await bookAhead(leo, mira);
    const res = await reschedule(leo, old.id, shift(old.startsAt, 2 * HOUR + 30 * MINUTE));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SLOT_NOT_AVAILABLE");
    expect((await sessionRow(old.id)).status).toBe("booked");
  });

  it("answers 409 to rescheduling a session that was already moved", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later, last] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();
    expect((await reschedule(leo, old.id, later!.startsAt)).statusCode).toBe(201);
    const again = await reschedule(leo, old.id, last!.startsAt);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("NOT_ACTIVE");
    expect(await bookedOf(leo)).toBe(1);
  });
});

describe("concurrent changes to one session", () => {
  it("lets only one of two simultaneous reschedules through", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , a, , b] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();

    const results = await Promise.all([a, b].map((slot) => reschedule(leo, old.id, slot!.startsAt)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("NOT_ACTIVE");
    expect(await bookedOf(leo)).toBe(1);
    expect(await count("sessions WHERE rescheduled_from = $1", [old.id])).toBe(1);
  });

  it("lets only one of a simultaneous cancel and reschedule through", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();

    const [c, r] = await Promise.all([cancel(mira, old.id), reschedule(leo, old.id, later!.startsAt)]);
    const codes = [c.statusCode, r.statusCode];
    expect([[200, 409], [409, 201]]).toContainEqual(codes);
    expect((codes[0] === 409 ? c : r).json().error.code).toBe("NOT_ACTIVE");
    // A cancel that won leaves no session; a reschedule that won leaves exactly the new one.
    expect(await bookedOf(leo)).toBe(codes[0] === 200 ? 0 : 1);
  });

  it("gives the time to exactly one of a reschedule and another member's booking racing for it", async () => {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const [first, , target] = await slotsAhead(leo, mira, 30);
    const old = (await book(leo, mira, first!.startsAt)).json();

    const [r, b] = await Promise.all([reschedule(leo, old.id, target!.startsAt), book(ana, mira, target!.startsAt)]);
    expect([r.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await count("sessions WHERE starts_at = $1 AND status = 'booked'", [target!.startsAt])).toBe(1);
    expect(await bookedOf(leo)).toBe(1);
    // The member who lost the reschedule still has the old time.
    if (r.statusCode === 409) expect((await sessionRow(old.id)).status).toBe("booked");
  });
});

describe("access to cancel and reschedule", () => {
  it("answers 404 to a member changing another member's session, an unknown id and a malformed id", async () => {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const s = (await book(leo, mira, first!.startsAt)).json();
    for (const id of [s.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await cancel(ana, id)).statusCode).toBe(404);
      expect((await reschedule(ana, id, later!.startsAt)).statusCode).toBe(404);
    }
    expect((await sessionRow(s.id)).status).toBe("booked");
    expect(await count("sessions")).toBe(1);
  });

  it("does not let a professional reschedule, even their own session", async () => {
    const mira = await professional();
    const leo = await member();
    const [first, , later] = await slotsAhead(leo, mira, 30);
    const s = (await book(leo, mira, first!.startsAt)).json();
    expect((await reschedule(mira, s.id, later!.startsAt)).statusCode).toBe(403);
  });

  it("answers 404 to a professional cancelling another professional's session", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon");
    const leo = await member();
    const s = await bookAhead(leo, mira);
    expect((await cancel(ravi, s.id)).statusCode).toBe(404);
    expect((await sessionRow(s.id)).status).toBe("booked");
  });

  it("answers 401 to someone not signed in", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await app.inject({ method: "POST", url: `/api/sessions/${id}/cancel` })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: `/api/sessions/${id}/reschedule`, payload: { startsAt: new Date().toISOString() } });
    expect(res.statusCode).toBe(401);
  });

  it("answers 400 to a reschedule without a valid start time", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira);
    for (const startsAt of [undefined, "tomorrow"]) {
      expect((await reschedule(leo, s.id, startsAt as unknown as string)).statusCode).toBe(400);
    }
  });
});
