import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDb } from "../src/db/client.ts";
import { deliverDueReminders } from "../src/reminders/deliver.ts";
import { createTestPool } from "./db.ts";

// Bookings run on real time (the database refuses past starts with its own clock);
// delivery takes "now" as an argument, so a test can jump to any moment before or after the session.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const pool = createTestPool();
const db = createDb(pool);
const app = buildApp({ pool, clock: { now: () => new Date() } });

type Slot = { startsAt: string; endsAt: string };
type User = { id: string; token: string };
type Booked = { id: string; startsAt: string };

// Every hour of every day is a slot, so a slot exists at any distance from now.
const allDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "23:59" }));

let seq = 0;
async function signup(name: string, role: "member" | "professional", timezone: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { name, email: `reminder${++seq}@example.test`, password: "a long enough password", role, timezone },
  });
  return { id: res.json().id, token: res.cookies.find((c) => c.name === "session")!.value };
}

// Professional in London, member in Singapore: the reminders are absolute hours, whatever the zones.
async function professional(name = "Dr. Mira Okafor"): Promise<User> {
  const pro = await signup(name, "professional", "Europe/London");
  const res = await app.inject({
    method: "PUT",
    url: "/api/availability",
    cookies: { session: pro.token },
    payload: { hours: allDay },
  });
  expect(res.statusCode).toBe(200);
  return pro;
}

const member = (name = "Leo Tanaka") => signup(name, "member", "Asia/Singapore");

// The free slots starting at least `hoursAhead` from now, soonest first.
async function slotsAhead(who: User, pro: User, hoursAhead: number): Promise<Slot[]> {
  const res = await app.inject({ method: "GET", url: `/api/professionals/${pro.id}/slots`, cookies: { session: who.token } });
  return (res.json().slots as Slot[]).filter((s) => new Date(s.startsAt).getTime() >= Date.now() + hoursAhead * HOUR);
}

async function bookAhead(who: User, pro: User, hoursAhead: number): Promise<Booked> {
  const [slot] = await slotsAhead(who, pro, hoursAhead);
  const res = await book(who, pro, slot!.startsAt);
  expect(res.statusCode).toBe(201);
  return res.json();
}

const book = (who: User, pro: User, startsAt: string) =>
  app.inject({ method: "POST", url: "/api/sessions", cookies: { session: who.token }, payload: { professionalId: pro.id, startsAt } });

const at = (session: Booked, offsetMs: number) => new Date(new Date(session.startsAt).getTime() + offsetMs);

async function remindersOf(sessionId: string) {
  const { rows } = await pool.query(
    "SELECT recipient_id, kind, due_at, delivered_at FROM reminders WHERE session_id = $1 ORDER BY due_at, recipient_id",
    [sessionId],
  );
  return rows as { recipient_id: string; kind: string; due_at: Date; delivered_at: Date | null }[];
}

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${sql}`);
  return rows[0].n;
}

const listNotifications = (who: User) =>
  app.inject({ method: "GET", url: "/api/notifications", cookies: { session: who.token } });

const markRead = (who: User, id: string) =>
  app.inject({ method: "POST", url: `/api/notifications/${id}/read`, cookies: { session: who.token } });

beforeEach(async () => {
  await pool.query("TRUNCATE users, auth_sessions, working_hours, sessions, reminders, notifications CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("reminders written with a booking", () => {
  it("gives a session 25 hours ahead a 24 h and a 1 h reminder for both people", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    const sorted = [leo.id, mira.id].sort();
    expect(await remindersOf(s.id)).toEqual([
      ...sorted.map((id) => ({ recipient_id: id, kind: "24h", due_at: at(s, -24 * HOUR), delivered_at: null })),
      ...sorted.map((id) => ({ recipient_id: id, kind: "1h", due_at: at(s, -HOUR), delivered_at: null })),
    ]);
  });

  it("gives a session 23 hours ahead only the 1 h reminders, because the 24 h time has passed", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 23);
    const rows = await remindersOf(s.id);
    expect(rows.map((r) => [r.kind, r.due_at])).toEqual([
      ["1h", at(s, -HOUR)],
      ["1h", at(s, -HOUR)],
    ]);
  });

  it("gives a session less than an hour ahead no reminders", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 0);
    expect(new Date(s.startsAt).getTime()).toBeLessThanOrEqual(Date.now() + HOUR);
    expect(await remindersOf(s.id)).toEqual([]);
  });

  it("still answers 409 to the loser of a race and keeps only the winner's four reminders", async () => {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const [slot] = await slotsAhead(leo, mira, 25);
    const results = await Promise.all([leo, ana].map((m) => book(m, mira, slot!.startsAt)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("SLOT_TAKEN");
    expect(await count("reminders")).toBe(4);
  });
});

describe("delivering due reminders", () => {
  it("turns each due reminder into one notification for its recipient, and never again", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    const now = at(s, -24 * HOUR + MINUTE);

    expect(await deliverDueReminders(db, now)).toBe(2);
    expect(await deliverDueReminders(db, now)).toBe(0);
    const { rows } = await pool.query("SELECT user_id, session_id, kind FROM notifications ORDER BY user_id");
    expect(rows).toEqual(
      [leo.id, mira.id].sort().map((id) => ({ user_id: id, session_id: s.id, kind: "reminder_24h" })),
    );
  });

  it("leaves no notification after a crash before commit, and a restarted worker delivers it exactly once", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    const now = at(s, -24 * HOUR + MINUTE);

    const crash = deliverDueReminders(db, now, {
      afterInsert: () => {
        throw new Error("process killed");
      },
    });
    await expect(crash).rejects.toThrow("process killed");
    expect(await count("notifications")).toBe(0);
    expect(await count("reminders WHERE delivered_at IS NULL")).toBe(4);

    // A new pool stands in for the restarted process: no connection or state survives.
    const restarted = createTestPool();
    try {
      expect(await deliverDueReminders(createDb(restarted), now)).toBe(2);
      expect(await deliverDueReminders(createDb(restarted), now)).toBe(0);
    } finally {
      await restarted.end();
    }
    expect(await count("notifications")).toBe(2);
    expect(await count("reminders WHERE kind = '24h' AND delivered_at IS NOT NULL")).toBe(2);
  });

  it("delivers twenty due reminders exactly once when two workers run at the same moment", async () => {
    const mira = await professional();
    const leo = await member();
    for (const slot of (await slotsAhead(leo, mira, 25)).slice(0, 5)) {
      expect((await book(leo, mira, slot.startsAt)).statusCode).toBe(201);
    }
    await pool.query("UPDATE reminders SET due_at = now() - interval '1 minute'");
    expect(await count("reminders")).toBe(20);

    const pools = [createTestPool(), createTestPool()];
    try {
      const now = new Date();
      const delivered = await Promise.all(pools.map((p) => deliverDueReminders(createDb(p), now)));
      expect(delivered[0]! + delivered[1]!).toBe(20);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
    expect(await count("notifications")).toBe(20);
    expect(await count("(SELECT DISTINCT reminder_id FROM notifications) d")).toBe(20);
  });

  it("lets a second worker skip reminders the first is still delivering, without waiting or repeating them", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    const now = at(s, -24 * HOUR + MINUTE);

    // The first worker holds its batch locked, mid-transaction, until we let it go.
    let reached!: () => void;
    let release!: () => void;
    const atHook = new Promise<void>((r) => (reached = r));
    const held = new Promise<void>((r) => (release = r));
    const other = createTestPool();
    try {
      const first = deliverDueReminders(createDb(other), now, {
        afterInsert: async () => {
          reached();
          await held;
        },
      });
      await atHook;
      expect(await deliverDueReminders(db, now)).toBe(0);
      release();
      expect(await first).toBe(2);
    } finally {
      await other.end();
    }
    expect(await count("notifications")).toBe(2);
  });

  it("never delivers a reminder marked cancelled", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    await pool.query("UPDATE reminders SET cancelled_at = now() WHERE session_id = $1", [s.id]);
    expect(await deliverDueReminders(db, at(s, -30 * MINUTE))).toBe(0);
    expect(await count("notifications")).toBe(0);
  });

  it("never delivers a reminder of a cancelled session, even if the reminder itself was not cancelled", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    await pool.query(
      "UPDATE sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'member' WHERE id = $1",
      [s.id, leo.id],
    );
    expect(await deliverDueReminders(db, at(s, -30 * MINUTE))).toBe(0);
    expect(await count("notifications")).toBe(0);
  });

  it("still delivers a late 24 h reminder once, if the worker finds it before the session starts", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    // The worker was down all day and comes back 30 minutes before the start: both kinds are due.
    expect(await deliverDueReminders(db, at(s, -30 * MINUTE))).toBe(4);
    expect(await deliverDueReminders(db, at(s, -29 * MINUTE))).toBe(0);
    const { rows } = await pool.query("SELECT kind, count(*)::int AS n FROM notifications GROUP BY kind ORDER BY kind");
    expect(rows).toEqual([
      { kind: "reminder_1h", n: 2 },
      { kind: "reminder_24h", n: 2 },
    ]);
  });

  it("does not deliver a reminder found after the session has started", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    expect(await deliverDueReminders(db, at(s, 0))).toBe(0);
    expect(await deliverDueReminders(db, at(s, MINUTE))).toBe(0);
    expect(await count("notifications")).toBe(0);
  });
});

describe("notifications in the app", () => {
  async function setup() {
    const mira = await professional();
    const leo = await member();
    const ana = await member("Ana Silva");
    const s = await bookAhead(leo, mira, 25);
    await deliverDueReminders(db, at(s, -24 * HOUR + MINUTE));
    await deliverDueReminders(db, at(s, -HOUR + MINUTE));
    return { mira, leo, ana, s };
  }

  it("lists only the caller's notifications, newest first, naming the other person", async () => {
    const { mira, leo, ana, s } = await setup();
    const session = { id: s.id, startsAt: s.startsAt, endsAt: at(s, 50 * MINUTE).toISOString() };

    const leos = await listNotifications(leo);
    expect(leos.statusCode).toBe(200);
    expect(leos.json()).toEqual([
      {
        id: expect.any(String),
        kind: "reminder_1h",
        createdAt: at(s, -HOUR + MINUTE).toISOString(),
        readAt: null,
        session: { ...session, counterpart: { name: "Dr. Mira Okafor" } },
      },
      {
        id: expect.any(String),
        kind: "reminder_24h",
        createdAt: at(s, -24 * HOUR + MINUTE).toISOString(),
        readAt: null,
        session: { ...session, counterpart: { name: "Dr. Mira Okafor" } },
      },
    ]);
    expect(leos.body).not.toContain("@example.test");

    const miras = (await listNotifications(mira)).json();
    expect(miras.map((n: { session: { counterpart: { name: string } } }) => n.session.counterpart.name)).toEqual([
      "Leo Tanaka",
      "Leo Tanaka",
    ]);
    expect((await listNotifications(ana)).json()).toEqual([]);
  });

  it("marks the caller's own notification read and keeps the first read time", async () => {
    const { leo } = await setup();
    const [newest] = (await listNotifications(leo)).json();
    const res = await markRead(leo, newest.id);
    expect(res.statusCode).toBe(204);
    const readAt = (await listNotifications(leo)).json()[0].readAt;
    expect(readAt).toEqual(expect.any(String));
    expect((await markRead(leo, newest.id)).statusCode).toBe(204);
    expect((await listNotifications(leo)).json()[0].readAt).toBe(readAt);
  });

  it("answers 404 for someone else's notification, an unknown id and a malformed id", async () => {
    const { mira, leo } = await setup();
    const [leosNewest] = (await listNotifications(leo)).json();
    for (const id of [leosNewest.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await markRead(mira, id)).statusCode).toBe(404);
    }
    expect((await listNotifications(leo)).json()[0].readAt).toBeNull();
  });

  it("does not let another member mark a notification read", async () => {
    const { leo, ana } = await setup();
    const [leosNewest] = (await listNotifications(leo)).json();
    expect((await markRead(ana, leosNewest.id)).statusCode).toBe(404);
    expect((await listNotifications(leo)).json()[0].readAt).toBeNull();
  });

  it("answers 401 to someone not signed in", async () => {
    expect((await app.inject({ method: "GET", url: "/api/notifications" })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/api/notifications/00000000-0000-4000-8000-000000000000/read" });
    expect(res.statusCode).toBe(401);
  });
});
