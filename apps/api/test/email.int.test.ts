import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDb } from "../src/db/client.ts";
import { reminderEmail } from "../src/email/content.ts";
import { sendDueEmails, type Mailer } from "../src/email/send.ts";
import { deliverDueReminders } from "../src/reminders/deliver.ts";
import { createTestPool } from "./db.ts";

// Same approach as the reminder tests: bookings on real time, delivery and sending at a chosen "now".
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const pool = createTestPool();
const db = createDb(pool);
const app = buildApp({ pool, clock: { now: () => new Date() } });

type User = { id: string; token: string; email: string };
type Booked = { id: string; startsAt: string };
type Sent = Parameters<Mailer["sendMail"]>[0];

const allDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "23:59" }));

let seq = 0;
async function signup(name: string, role: "member" | "professional", timezone: string): Promise<User> {
  const email = `email${++seq}@example.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { name, email, password: "a long enough password", role, timezone },
  });
  return { id: res.json().id, token: res.cookies.find((c) => c.name === "session")!.value, email };
}

// Professional in London, member in Singapore.
async function professional(): Promise<User> {
  const pro = await signup("Dr. Mira Okafor", "professional", "Europe/London");
  const res = await app.inject({ method: "PUT", url: "/api/availability", cookies: { session: pro.token }, payload: { hours: allDay } });
  expect(res.statusCode).toBe(200);
  return pro;
}
const member = () => signup("Leo Tanaka", "member", "Asia/Singapore");

async function slotsAhead(who: User, pro: User, hoursAhead: number): Promise<{ startsAt: string }[]> {
  const res = await app.inject({ method: "GET", url: `/api/professionals/${pro.id}/slots`, cookies: { session: who.token } });
  return (res.json().slots as { startsAt: string }[]).filter((s) => new Date(s.startsAt).getTime() >= Date.now() + hoursAhead * HOUR);
}

async function book(who: User, pro: User, startsAt: string): Promise<Booked> {
  const res = await app.inject({ method: "POST", url: "/api/sessions", cookies: { session: who.token }, payload: { professionalId: pro.id, startsAt } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const bookAhead = async (who: User, pro: User, hoursAhead: number) => book(who, pro, (await slotsAhead(who, pro, hoursAhead))[0]!.startsAt);
const at = (session: Booked, offsetMs: number) => new Date(new Date(session.startsAt).getTime() + offsetMs);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

const setEmailReminders = (who: User, emailReminders: unknown) =>
  app.inject({ method: "PATCH", url: "/api/me/preferences", cookies: { session: who.token }, payload: { emailReminders } });
const me = (who: User) => app.inject({ method: "GET", url: "/api/me", cookies: { session: who.token } });

async function count(from: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${from}`);
  return rows[0].n;
}

async function outbox() {
  const { rows } = await pool.query(
    `SELECT o.id, o.to_email, o.subject, o.body, o.sent_at, o.attempts, o.last_error, o.next_attempt_at, n.user_id
       FROM email_outbox o JOIN notifications n ON n.id = o.notification_id ORDER BY o.to_email`,
  );
  return rows as {
    id: string;
    to_email: string;
    subject: string;
    body: string;
    sent_at: Date | null;
    attempts: number;
    last_error: string | null;
    next_attempt_at: Date;
    user_id: string;
  }[];
}

// Records what it sends; `failing` makes every send throw like an unreachable SMTP server.
function fakeMailer() {
  const sent: Sent[] = [];
  const mailer = {
    sent,
    failing: false,
    async sendMail(msg: Sent) {
      if (mailer.failing) throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
      sent.push(msg);
      return {};
    },
  };
  return mailer;
}

// A booked session 25 h ahead, with the 24 h reminders delivered (and their emails queued) at `now`.
async function deliveredSession() {
  const mira = await professional();
  const leo = await member();
  const s = await bookAhead(leo, mira, 25);
  const now = at(s, -24 * HOUR + MINUTE);
  expect(await deliverDueReminders(db, now)).toBe(2);
  return { mira, leo, s, now };
}

beforeEach(async () => {
  await pool.query("TRUNCATE users, auth_sessions, working_hours, sessions, reminders, notifications, email_outbox CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("reminder email text", () => {
  it("gives the start in the reader's zone on both sides of the London spring-forward", () => {
    expect(reminderEmail("24h", new Date("2027-03-27T09:00:00Z"), "Europe/London").body).toContain(
      "starts in about 24 hours: Saturday, 27 March 2027 at 09:00 GMT (Europe/London)",
    );
    expect(reminderEmail("1h", new Date("2027-03-28T09:00:00Z"), "Europe/London").body).toContain(
      "starts in about 1 hour: Sunday, 28 March 2027 at 10:00 BST (Europe/London)",
    );
  });

  it("tells apart the two 01:30s of the New York fall-back night", () => {
    const first = reminderEmail("1h", new Date("2027-11-07T05:30:00Z"), "America/New_York").body;
    const second = reminderEmail("1h", new Date("2027-11-07T06:30:00Z"), "America/New_York").body;
    expect(first).toContain("Sunday, 7 November 2027 at 01:30 GMT-4");
    expect(second).toContain("Sunday, 7 November 2027 at 01:30 GMT-5");
  });

  it("shows a London 09:00 session as 17:00 to a member in Singapore", () => {
    const { subject, body } = reminderEmail("24h", new Date("2027-01-11T09:00:00Z"), "Asia/Singapore");
    expect(subject).toBe("Reminder: you have a session soon");
    expect(body).toContain("Monday, 11 January 2027 at 17:00 GMT+8 (Asia/Singapore)");
  });
});

describe("queueing reminder emails", () => {
  it("queues one email per in-app reminder, committed in the same transaction", async () => {
    const mira = await professional();
    const leo = await member();
    const s = await bookAhead(leo, mira, 25);
    const now = at(s, -24 * HOUR + MINUTE);

    // Paused just before the commit, another connection sees neither the notifications nor the emails.
    let reached!: () => void;
    let release!: () => void;
    const atHook = new Promise<void>((r) => (reached = r));
    const held = new Promise<void>((r) => (release = r));
    const other = createTestPool();
    try {
      const delivering = deliverDueReminders(createDb(other), now, {
        afterInsert: async () => {
          reached();
          await held;
        },
      });
      await atHook;
      expect(await count("notifications")).toBe(0);
      expect(await count("email_outbox")).toBe(0);
      release();
      expect(await delivering).toBe(2);
    } finally {
      await other.end();
    }

    expect((await outbox()).map((o) => [o.user_id, o.to_email])).toEqual(
      [leo, mira].sort((a, b) => a.email.localeCompare(b.email)).map((u) => [u.id, u.email]),
    );
    expect(await deliverDueReminders(db, now)).toBe(0);
    expect(await count("email_outbox")).toBe(2);
  });

  it("queues no email for someone who turned email reminders off, but still gives them the in-app reminder", async () => {
    const mira = await professional();
    const leo = await member();
    expect((await setEmailReminders(leo, false)).statusCode).toBe(200);
    const s = await bookAhead(leo, mira, 25);

    expect(await deliverDueReminders(db, at(s, -24 * HOUR + MINUTE))).toBe(2);
    expect(await count(`notifications WHERE user_id = '${leo.id}'`)).toBe(1);
    expect((await outbox()).map((o) => o.user_id)).toEqual([mira.id]);
  });

  it("leaves neither the notification nor the email after a crash before commit, and a restarted worker queues each once", async () => {
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
    expect(await count("email_outbox")).toBe(0);

    const restarted = createTestPool();
    try {
      expect(await deliverDueReminders(createDb(restarted), now)).toBe(2);
    } finally {
      await restarted.end();
    }
    expect(await count("notifications")).toBe(2);
    expect(await count("email_outbox")).toBe(2);
  });

  it("writes the start in each recipient's own zone and never names the other person", async () => {
    const { mira, leo, s, now } = await deliveredSession();
    const mailer = fakeMailer();
    expect(await sendDueEmails(db, mailer, now)).toBe(2);

    const rows = await outbox();
    const everything = [...rows.flatMap((o) => [o.subject, o.body]), ...mailer.sent.flatMap((m) => [m.subject, m.text])].join("\n");
    for (const name of ["Mira", "Okafor", "Leo", "Tanaka"]) expect(everything).not.toContain(name);
    const startsAt = new Date(s.startsAt);
    expect(rows.find((o) => o.user_id === leo.id)!.body).toBe(reminderEmail("24h", startsAt, "Asia/Singapore").body);
    expect(rows.find((o) => o.user_id === mira.id)!.body).toBe(reminderEmail("24h", startsAt, "Europe/London").body);
  });
});

describe("sending queued emails", () => {
  it("sends each queued email once, with its outbox id as the Message-ID, and marks it sent", async () => {
    const { mira, leo, now } = await deliveredSession();
    const mailer = fakeMailer();

    expect(await sendDueEmails(db, mailer, now, "Test <from@thoughtfull.local>")).toBe(2);
    expect(await sendDueEmails(db, mailer, plus(now, MINUTE))).toBe(0);

    const rows = await outbox();
    expect(rows.every((o) => o.sent_at?.getTime() === now.getTime())).toBe(true);
    expect(mailer.sent.map((m) => [m.to, m.messageId, m.from]).sort()).toEqual(
      rows.map((o) => [o.to_email, `<${o.id}@thoughtfull.local>`, "Test <from@thoughtfull.local>"]).sort(),
    );
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([leo.email, mira.email].sort());
  });

  it("sends ten queued emails exactly once when two senders run at the same moment", async () => {
    const mira = await professional();
    const leo = await member();
    expect((await setEmailReminders(mira, false)).statusCode).toBe(200);
    for (const slot of (await slotsAhead(leo, mira, 25)).slice(0, 5)) await book(leo, mira, slot.startsAt);
    await pool.query("UPDATE reminders SET due_at = now() - interval '1 minute'");
    const now = new Date();
    expect(await deliverDueReminders(db, now)).toBe(20);
    expect(await count("email_outbox")).toBe(10);

    const mailer = fakeMailer();
    const pools = [createTestPool(), createTestPool()];
    try {
      const sent = await Promise.all(pools.map((p) => sendDueEmails(createDb(p), mailer, now)));
      expect(sent[0]! + sent[1]!).toBe(10);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
    expect(mailer.sent).toHaveLength(10);
    expect(new Set(mailer.sent.map((m) => m.messageId)).size).toBe(10);
    expect(await count("email_outbox WHERE sent_at IS NULL")).toBe(0);
  });

  it("lets a second sender skip an email the first is still sending, without waiting for it", async () => {
    const { now } = await deliveredSession();

    // The first sender's mail server hangs on its first email until we let it go.
    let reached!: () => void;
    let release!: () => void;
    const atSend = new Promise<void>((r) => (reached = r));
    const held = new Promise<void>((r) => (release = r));
    const slow = fakeMailer();
    const hanging: Mailer = {
      async sendMail(msg) {
        reached();
        await held;
        return slow.sendMail(msg);
      },
    };
    const fast = fakeMailer();
    const other = createTestPool();
    try {
      const first = sendDueEmails(createDb(other), hanging, now);
      await atSend;
      const second = sendDueEmails(db, fast, now);
      const timedOut = new Promise((r) => setTimeout(() => r("still waiting"), 3000));
      expect(await Promise.race([second, timedOut])).toBe(1);
      release();
      expect(await first).toBe(1);
    } finally {
      release();
      await other.end();
    }
    expect(new Set([...slow.sent, ...fast.sent].map((m) => m.messageId)).size).toBe(2);
  });

  it("records a failed send, waits a minute, then the retry sends it", async () => {
    const { now } = await deliveredSession();
    const mailer = fakeMailer();
    mailer.failing = true;

    expect(await sendDueEmails(db, mailer, now)).toBe(0);
    for (const o of await outbox()) {
      expect(o).toMatchObject({ sent_at: null, attempts: 1, last_error: "connect ECONNREFUSED 127.0.0.1:1025" });
      expect(o.next_attempt_at).toEqual(plus(now, MINUTE));
    }

    mailer.failing = false;
    expect(await sendDueEmails(db, mailer, plus(now, MINUTE - 1000))).toBe(0);
    expect(await sendDueEmails(db, mailer, plus(now, MINUTE))).toBe(2);
    expect((await outbox()).map((o) => [o.attempts, o.sent_at])).toEqual([
      [1, plus(now, MINUTE)],
      [1, plus(now, MINUTE)],
    ]);
  });

  it("gives up after five failed attempts, waiting 1, 5, 15 and 15 minutes between them", async () => {
    const { now } = await deliveredSession();
    const mailer = fakeMailer();
    mailer.failing = true;

    let t = now;
    for (const waitMinutes of [1, 5, 15, 15]) {
      expect(await sendDueEmails(db, mailer, t)).toBe(0);
      const next = plus(t, waitMinutes * MINUTE);
      expect((await outbox()).map((o) => o.next_attempt_at)).toEqual([next, next]);
      t = next;
    }
    expect(await sendDueEmails(db, mailer, t)).toBe(0);
    expect((await outbox()).map((o) => o.attempts)).toEqual([5, 5]);

    mailer.failing = false;
    expect(await sendDueEmails(db, mailer, plus(t, HOUR))).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it("drops a waiting retry once the session is cancelled, instead of reminding about it", async () => {
    const { leo, s, now } = await deliveredSession();
    const mailer = fakeMailer();
    mailer.failing = true;
    expect(await sendDueEmails(db, mailer, now)).toBe(0);

    await pool.query(
      "UPDATE sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'member' WHERE id = $1",
      [s.id, leo.id],
    );
    mailer.failing = false;
    expect(await sendDueEmails(db, mailer, plus(now, MINUTE))).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("email reminder preference", () => {
  it("is on for a new account, and a user can turn it off and on for their own account only", async () => {
    const mira = await professional();
    const leo = await member();
    expect((await me(leo)).json().emailReminders).toBe(true);

    // A client-sent user id is ignored: the session decides whose preference changes.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me/preferences",
      cookies: { session: leo.token },
      payload: { emailReminders: false, userId: mira.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: leo.id, role: "member", name: "Leo Tanaka", timezone: "Asia/Singapore", emailReminders: false });
    expect((await me(leo)).json().emailReminders).toBe(false);
    expect((await me(mira)).json().emailReminders).toBe(true);

    expect((await setEmailReminders(leo, true)).json().emailReminders).toBe(true);
    expect((await me(leo)).json().emailReminders).toBe(true);
  });

  it("refuses a change from someone not signed in, or without a true/false value", async () => {
    const leo = await member();
    const anon = await app.inject({ method: "PATCH", url: "/api/me/preferences", payload: { emailReminders: false } });
    expect(anon.statusCode).toBe(401);
    expect((await setEmailReminders(leo, "no")).statusCode).toBe(400);
    expect((await me(leo)).json().emailReminders).toBe(true);
  });
});
