import { groupSlotsByLocalDay } from "@thoughtfull/domain";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDb } from "../src/db/client.ts";
import { seed } from "../src/seed.ts";
import { createTestPool } from "./db.ts";

// The app clock is pinned to dates after today's real date, so bookings also pass the
// database's own no-past-start check. Monday 2027-01-04 08:00 UTC (= London time in January).
const START = "2027-01-04T08:00:00.000Z";
let nowIso = START;
const pool = createTestPool();
const app = buildApp({ pool, clock: { now: () => new Date(nowIso) } });

type Slot = { startsAt: string; endsAt: string };
type User = { id: string; token: string };

let seq = 0;
async function signup(name: string, role: "member" | "professional", timezone: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { name, email: `timeoff${++seq}@example.test`, password: "a long enough password", role, timezone },
  });
  return { id: res.json().id, token: res.cookies.find((c) => c.name === "session")!.value };
}

const call = (who: User | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, cookies: who ? { session: who.token } : {}, ...(payload ? { payload } : {}) });

const everyDay = (start: string, end: string) => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start, end }));

async function professional(name = "Dr. Mira Okafor", timezone = "Europe/London", hours = everyDay("09:00", "17:00")) {
  const pro = await signup(name, "professional", timezone);
  expect((await call(pro, "PUT", "/api/availability", { hours })).statusCode).toBe(200);
  return pro;
}
const member = (name = "Leo Tanaka") => signup(name, "member", "Asia/Singapore");

const block = (pro: User, day: string, reason?: string) => call(pro, "POST", "/api/blocked-dates", { day, reason });
const blockedList = (pro: User) => call(pro, "GET", "/api/blocked-dates");
const setNotice = (pro: User, minNoticeMinutes: unknown) => call(pro, "PUT", "/api/booking-settings", { minNoticeMinutes });
const book = (who: User, pro: User, startsAt: string) => call(who, "POST", "/api/sessions", { professionalId: pro.id, startsAt });
const starts = async (who: User, pro: User): Promise<string[]> =>
  ((await call(who, "GET", `/api/professionals/${pro.id}/slots`)).json().slots as Slot[]).map((s) => s.startsAt);

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${sql}`, params);
  return rows[0].n;
}

// Waits until `n` connections are blocked on a row lock, so a test can line up requests behind a barrier.
async function lockWaiters(n: number) {
  const sql = "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";
  while ((await pool.query(sql)).rows[0].n < n) await new Promise((r) => setTimeout(r, 10));
}

beforeEach(async () => {
  nowIso = START;
  await pool.query("TRUNCATE users, auth_sessions, working_hours, sessions, blocked_dates CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("blocking a day", () => {
  it("removes the day's slots for members, and the slots list still says nothing but times", async () => {
    const mira = await professional();
    const leo = await member();
    expect((await block(mira, "2027-01-06", "Training day")).statusCode).toBe(201);

    const res = await call(leo, "GET", `/api/professionals/${mira.id}/slots`);
    const list: string[] = res.json().slots.map((s: Slot) => s.startsAt);
    expect(list.filter((s) => s.startsWith("2027-01-06"))).toEqual([]);
    expect(list.filter((s) => s.startsWith("2027-01-05"))).toHaveLength(8);
    expect(list.filter((s) => s.startsWith("2027-01-07"))).toHaveLength(8);
    expect(Object.keys(res.json())).toEqual(["slots"]);
    for (const s of res.json().slots) expect(Object.keys(s).sort()).toEqual(["endsAt", "startsAt"]);
    expect(res.body).not.toContain("Training day");
  });

  it("refuses a booking on a blocked day as an unavailable time, without revealing the time off", async () => {
    const mira = await professional();
    const leo = await member();
    await block(mira, "2027-01-06", "Training day");
    const res = await book(leo, mira, "2027-01-06T10:00:00.000Z");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SLOT_NOT_AVAILABLE");
    expect(res.body).not.toContain("Training");
    expect(await count("sessions")).toBe(0);
  });

  it("keeps a session already booked on the day and reports how many there are", async () => {
    const mira = await professional();
    const leo = await member();
    const booked = await book(leo, mira, "2027-01-06T10:00:00.000Z");
    expect(booked.statusCode).toBe(201);
    // A cancelled session on the same day is not counted.
    const other = await book(leo, mira, "2027-01-06T14:00:00.000Z");
    expect((await call(leo, "POST", `/api/sessions/${other.json().id}/cancel`)).statusCode).toBe(200);

    const res = await block(mira, "2027-01-06", "Training day");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ day: "2027-01-06", reason: "Training day", bookedSessions: 1 });
    expect((await blockedList(mira)).json()).toEqual([{ day: "2027-01-06", reason: "Training day", bookedSessions: 1 }]);
    expect(await count("sessions WHERE id = $1 AND status = 'booked'", [booked.json().id])).toBe(1);
  });

  it("lists only today and later in the professional's zone, soonest first, with no reason as null", async () => {
    const mira = await professional();
    await block(mira, "2027-01-20");
    await block(mira, "2027-01-05", "  Dentist  ");
    await block(mira, "2027-01-04");
    expect((await blockedList(mira)).json()).toEqual([
      { day: "2027-01-04", reason: null, bookedSessions: 0 },
      { day: "2027-01-05", reason: "Dentist", bookedSessions: 0 },
      { day: "2027-01-20", reason: null, bookedSessions: 0 },
    ]);
    nowIso = "2027-01-05T23:59:00.000Z";
    expect((await blockedList(mira)).json().map((b: { day: string }) => b.day)).toEqual(["2027-01-05", "2027-01-20"]);
  });

  it("refuses a past day, a day more than 365 days ahead, a day already blocked and malformed input", async () => {
    const mira = await professional();
    const expectError = async (res: Awaited<ReturnType<typeof block>>, status: number, code: string) => {
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
    };
    await expectError(await block(mira, "2027-01-03"), 422, "PAST_DAY");
    expect((await block(mira, "2027-01-04")).statusCode).toBe(201); // today is allowed
    expect((await block(mira, "2028-01-04")).statusCode).toBe(201); // exactly 365 days ahead
    await expectError(await block(mira, "2028-01-05"), 422, "TOO_FAR");
    await expectError(await block(mira, "2027-01-04"), 409, "ALREADY_BLOCKED");
    for (const payload of [{ day: "2027-02-30" }, { day: "2027-1-5" }, {}, { day: "2027-01-05", reason: "x".repeat(81) }]) {
      await expectError(await call(mira, "POST", "/api/blocked-dates", payload), 400, "VALIDATION_ERROR");
    }
  });

  it("decides 'today' in the professional's zone, not the server's", async () => {
    // 20:00 UTC on Jan 4 is already Jan 5 in Singapore.
    nowIso = "2027-01-04T20:00:00.000Z";
    const aiko = await professional("Aiko Tanaka", "Asia/Singapore");
    expect((await block(aiko, "2027-01-04")).json().error.code).toBe("PAST_DAY");
    expect((await block(aiko, "2027-01-05")).statusCode).toBe(201);
  });

  it("frees the day again when the block is removed", async () => {
    const mira = await professional();
    const leo = await member();
    await block(mira, "2027-01-06");
    expect((await call(mira, "DELETE", "/api/blocked-dates/2027-01-06")).statusCode).toBe(204);
    expect((await starts(leo, mira)).filter((s) => s.startsWith("2027-01-06"))).toHaveLength(8);
    expect((await blockedList(mira)).json()).toEqual([]);
    for (const day of ["2027-01-06", "not-a-day", "2027-02-30"]) {
      const res = await call(mira, "DELETE", `/api/blocked-dates/${day}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
  });

  it("lets another professional neither see nor remove my time off", async () => {
    const mira = await professional();
    const ravi = await professional("Dr. Ravi Menon", "America/New_York");
    await block(mira, "2027-01-06", "Training day");
    const seen = await blockedList(ravi);
    expect(seen.json()).toEqual([]);
    expect(seen.body).not.toContain("Training");
    expect((await call(ravi, "DELETE", "/api/blocked-dates/2027-01-06")).statusCode).toBe(404);
    expect((await blockedList(mira)).json()).toHaveLength(1);
    // Each professional has their own days: the same date can be blocked by both.
    expect((await block(ravi, "2027-01-06")).statusCode).toBe(201);
  });

  it("is for professionals only: members get 403 and signed-out callers 401", async () => {
    const leo = await member();
    const requests = [
      ["GET", "/api/blocked-dates"],
      ["POST", "/api/blocked-dates", { day: "2027-01-06" }],
      ["DELETE", "/api/blocked-dates/2027-01-06"],
      ["GET", "/api/booking-settings"],
      ["PUT", "/api/booking-settings", { minNoticeMinutes: 60 }],
    ] as const;
    for (const [method, url, payload] of requests) {
      expect((await call(leo, method, url, payload)).statusCode).toBe(403);
      expect((await call(null, method, url, payload)).statusCode).toBe(401);
    }
    expect(await count("blocked_dates")).toBe(0);
  });

  it("removes exactly the 23 hours of the spring-forward day in London", async () => {
    nowIso = "2027-03-20T00:00:00.000Z";
    const mira = await professional("Dr. Mira Okafor", "Europe/London", everyDay("00:00", "23:59"));
    const leo = await member();
    const before = await starts(leo, mira);
    await block(mira, "2027-03-28");
    const after = await starts(leo, mira);

    const removed = before.filter((s) => !after.includes(s));
    // London's 28 March runs from 00:00 GMT (00:00Z) to 00:00 BST (23:00Z); 01:00 does not exist.
    expect(removed).toHaveLength(23);
    expect(removed[0]).toBe("2027-03-28T00:00:00.000Z");
    expect(removed.at(-1)).toBe("2027-03-28T22:00:00.000Z");
    // The neighbours on each side of local midnight stay.
    expect(after).toContain("2027-03-27T23:00:00.000Z"); // Saturday 23:00 GMT
    expect(after).toContain("2027-03-28T23:00:00.000Z"); // Monday 00:00 BST
  });

  it("blocks the professional's Monday, even the slots a Singapore member sees on Tuesday", async () => {
    const mira = await professional("Dr. Mira Okafor", "Europe/London", [{ weekday: 1, start: "09:00", end: "17:00" }]);
    const leo = await member();
    const tuesdayInSingapore = async () =>
      groupSlotsByLocalDay((await starts(leo, mira)).map((s) => ({ startsAt: new Date(s) })), "Asia/Singapore")
        .find((g) => g.day === "2027-01-12")
        ?.slots.map((s) => s.startsAt.toISOString());
    // London Monday 16:00 is Tuesday 00:00 in Singapore.
    expect(await tuesdayInSingapore()).toEqual(["2027-01-11T16:00:00.000Z"]);

    await block(mira, "2027-01-11");
    expect(await tuesdayInSingapore()).toBeUndefined();
    const after = await starts(leo, mira);
    expect(after.filter((s) => s.startsWith("2027-01-11"))).toEqual([]);
    expect(after).toContain("2027-01-04T16:00:00.000Z");
    expect(after).toContain("2027-01-18T16:00:00.000Z");
  });
});

describe("minimum booking notice", () => {
  it("starts at no notice, saves an allowed value, refuses any other and shows it on the profile", async () => {
    const mira = await professional();
    const leo = await member();
    expect((await call(mira, "GET", "/api/booking-settings")).json()).toEqual({ minNoticeMinutes: 0 });
    const saved = await setNotice(mira, 120);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ minNoticeMinutes: 120 });
    for (const bad of [90, -60, 1440.5, "120", null]) {
      const res = await setNotice(mira, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect((await call(mira, "GET", "/api/booking-settings")).json()).toEqual({ minNoticeMinutes: 120 });
    expect((await call(leo, "GET", `/api/professionals/${mira.id}`)).json()).toEqual({
      id: mira.id,
      name: "Dr. Mira Okafor",
      timezone: "Europe/London",
      minNoticeMinutes: 120,
    });
  });

  it("with 2 hours' notice, hides and refuses a slot 119 minutes away, and offers and books one 120 or 121 minutes away", async () => {
    const mira = await professional();
    const leo = await member();
    await setNotice(mira, 120);
    const ten = "2027-01-04T10:00:00.000Z";

    nowIso = "2027-01-04T08:01:00.000Z"; // 119 minutes before 10:00
    expect(await starts(leo, mira)).not.toContain(ten);
    const tooSoon = await book(leo, mira, ten);
    expect(tooSoon.statusCode).toBe(422);
    expect(tooSoon.json().error).toEqual({ code: "TOO_SOON", message: "This professional needs at least 2 hours notice." });

    nowIso = "2027-01-04T08:00:00.000Z"; // exactly 120 minutes
    expect(await starts(leo, mira)).toContain(ten);

    nowIso = "2027-01-04T07:59:00.000Z"; // 121 minutes
    expect(await starts(leo, mira)).toContain(ten);
    expect((await book(leo, mira, ten)).statusCode).toBe(201);
  });

  it("names the notice in hours in the refusal", async () => {
    const mira = await professional();
    const leo = await member();
    nowIso = "2027-01-04T08:30:00.000Z"; // 09:00 is 30 minutes away, inside every notice
    for (const [minutes, words] of [[60, "1 hour"], [1440, "24 hours"], [2880, "48 hours"]] as const) {
      await setNotice(mira, minutes);
      const res = await book(leo, mira, "2027-01-04T09:00:00.000Z");
      expect(res.json().error.message).toBe(`This professional needs at least ${words} notice.`);
    }
  });

  it("applies to a reschedule as well, and so does time off", async () => {
    const mira = await professional();
    const leo = await member();
    const old = (await book(leo, mira, "2027-01-08T10:00:00.000Z")).json();
    await setNotice(mira, 120);
    await block(mira, "2027-01-06");
    nowIso = "2027-01-04T08:30:00.000Z";
    const move = (startsAt: string) => call(leo, "POST", `/api/sessions/${old.id}/reschedule`, { startsAt });

    expect((await move("2027-01-04T10:00:00.000Z")).json().error.code).toBe("TOO_SOON");
    expect((await move("2027-01-06T10:00:00.000Z")).json().error.code).toBe("SLOT_NOT_AVAILABLE");
    expect((await move("2027-01-04T11:00:00.000Z")).statusCode).toBe(201);
  });
});

describe("blocking a day while a member books it", () => {
  it("never leaves a session booked on a blocked day that the block did not report", async () => {
    const mira = await professional();
    const leo = await member();
    const outcomes = new Set<string>();

    for (let round = 0; round < 6; round++) {
      const day = `2027-01-${String(5 + round).padStart(2, "0")}`;
      // Holding the professional's row stops both requests at their lock, then frees them together.
      // Alternating which one queues first covers both orders.
      const holder = await pool.connect();
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [mira.id]);
      const first = round % 2 === 0 ? () => book(leo, mira, `${day}T10:00:00.000Z`) : () => block(mira, day);
      const second = round % 2 === 0 ? () => block(mira, day) : () => book(leo, mira, `${day}T10:00:00.000Z`);
      const a = first();
      await lockWaiters(1);
      const b = second();
      await lockWaiters(2);
      await holder.query("ROLLBACK");
      holder.release();
      const [bookRes, blockRes] = round % 2 === 0 ? await Promise.all([a, b]) : await Promise.all([b, a]);

      expect(blockRes.statusCode).toBe(201);
      if (bookRes.statusCode === 201) {
        // The booking committed first, so the block saw it.
        expect(blockRes.json().bookedSessions).toBe(1);
        outcomes.add("booked, then blocked");
      } else {
        expect(bookRes.json().error.code).toBe("SLOT_NOT_AVAILABLE");
        expect(blockRes.json().bookedSessions).toBe(0);
        outcomes.add("blocked, then refused");
      }
    }
    // Both orders really happened, so the check inside the booking transaction was exercised.
    expect([...outcomes].sort()).toEqual(["blocked, then refused", "booked, then blocked"]);
  });
});

describe("changing hours or notice while a member books", () => {
  const ten = "2027-01-04T10:00:00.000Z"; // two hours after the pinned clock, 10:00 in London

  // Stands in for a settings save that has locked the professional's row and changed it but not yet
  // committed. The booking is started, shown to be waiting on that lock, then the change commits.
  async function racingChange(pro: User, change: string, params: unknown[], request: () => ReturnType<typeof book>) {
    const holder = await pool.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE", [pro.id]);
    await holder.query(change, params);
    const res = request();
    await lockWaiters(1);
    await holder.query("COMMIT");
    holder.release();
    return res;
  }

  it("refuses a slot whose working hours are removed while the booking waits", async () => {
    const mira = await professional();
    const leo = await member();
    const res = await racingChange(mira, "DELETE FROM working_hours WHERE professional_id = $1", [mira.id], () =>
      book(leo, mira, ten),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SLOT_NOT_AVAILABLE");
    expect(await count("sessions")).toBe(0);
  });

  it("refuses with the new notice when the notice is raised while the booking waits", async () => {
    const mira = await professional();
    const leo = await member();
    const res = await racingChange(mira, "UPDATE users SET min_notice_minutes = 1440 WHERE id = $1", [mira.id], () =>
      book(leo, mira, ten),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toEqual({ code: "TOO_SOON", message: "This professional needs at least 24 hours notice." });
    expect(await count("sessions")).toBe(0);
  });

  it("refuses a reschedule onto hours removed while it waits, and keeps the old session", async () => {
    const mira = await professional();
    const leo = await member();
    const old = (await book(leo, mira, "2027-01-08T10:00:00.000Z")).json();
    const res = await racingChange(mira, "DELETE FROM working_hours WHERE professional_id = $1", [mira.id], () =>
      call(leo, "POST", `/api/sessions/${old.id}/reschedule`, { startsAt: "2027-01-07T10:00:00.000Z" }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SLOT_NOT_AVAILABLE");
    expect(await count("sessions WHERE status = 'booked'")).toBe(1);
    expect(await count("sessions WHERE id = $1 AND status = 'booked'", [old.id])).toBe(1);
  });

  it("makes a notice change wait for a booking that holds the professional's row", async () => {
    const mira = await professional();
    const holder = await pool.connect();
    await holder.query("BEGIN");
    // The same lock a booking takes before it reads the professional's slots.
    await holder.query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE", [mira.id]);
    const saved = setNotice(mira, 1440);
    await lockWaiters(1);
    expect((await holder.query("SELECT min_notice_minutes AS n FROM users WHERE id = $1", [mira.id])).rows).toEqual([{ n: 0 }]);
    await holder.query("COMMIT");
    holder.release();
    expect((await saved).json()).toEqual({ minNoticeMinutes: 1440 });
  });
});

describe("demo data", () => {
  it("gives the demo professionals 2 hours' notice and Dr. Mira Okafor one weekday off, also when run twice", async () => {
    // Friday 2027-01-08: three weeks ahead is Friday 29 January.
    const now = new Date("2027-01-08T12:00:00.000Z");
    await seed(createDb(pool), "demo-password-123", now);
    await seed(createDb(pool), "demo-password-123", now);
    const { rows: notice } = await pool.query("SELECT DISTINCT min_notice_minutes AS n FROM users WHERE role = 'professional'");
    expect(notice).toEqual([{ n: 120 }]);
    const { rows: days } = await pool.query("SELECT day::text, reason FROM blocked_dates");
    expect(days).toEqual([{ day: "2027-01-29", reason: "Training day" }]);

    // Run on a Saturday, three weeks ahead is a Saturday too, so the day moves to the Monday.
    await pool.query("DELETE FROM blocked_dates");
    await seed(createDb(pool), "demo-password-123", new Date("2027-01-09T12:00:00.000Z"));
    expect((await pool.query("SELECT day::text FROM blocked_dates")).rows).toEqual([{ day: "2027-02-01" }]);
  });
});
