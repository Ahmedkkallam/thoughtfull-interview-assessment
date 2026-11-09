import { groupSlotsByLocalDay } from "@thoughtfull/domain";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTestPool } from "./db.ts";

// Monday 2027-01-04 08:00 UTC; the clock can be moved within a test.
let nowIso = "2027-01-04T08:00:00.000Z";
const pool = createTestPool();
const app = buildApp({ pool, clock: { now: () => new Date(nowIso) } });

const mira = { name: "Dr. Mira Okafor", email: "mira.okafor@example.test", password: "correct horse battery", role: "professional", timezone: "Europe/London" };
const ravi = { name: "Dr. Ravi Menon", email: "ravi.menon@example.test", password: "another good password", role: "professional", timezone: "America/New_York" };
const leo = { name: "Leo Tanaka", email: "leo.tanaka@example.test", password: "yet another password", role: "member", timezone: "Asia/Singapore" };
const priya = { name: "Priya Nair", email: "priya.nair@example.test", password: "a fifth password", role: "member", timezone: "Asia/Kolkata" };
const ana = { name: "Ana Silva", email: "ana.silva@example.test", password: "a fourth password", role: "member", timezone: "America/Los_Angeles" };

async function signup(body: object) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  return { id: res.json().id as string, token: res.cookies.find((c) => c.name === "session")!.value };
}
const get = (token: string | null, url: string) =>
  app.inject({ method: "GET", url, cookies: token ? { session: token } : {} });
const putHours = (token: string, hours: unknown) =>
  app.inject({ method: "PUT", url: "/api/availability", cookies: { session: token }, payload: { hours } });

beforeEach(async () => {
  nowIso = "2027-01-04T08:00:00.000Z";
  await pool.query("TRUNCATE users, auth_sessions, working_hours CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("professionals", () => {
  it("lists professionals only, sorted by name, with only id, name and timezone", async () => {
    const m = await signup(mira);
    const r = await signup(ravi);
    const member = await signup(leo);
    const res = await get(member.token, "/api/professionals");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: m.id, name: mira.name, timezone: "Europe/London" },
      { id: r.id, name: ravi.name, timezone: "America/New_York" },
    ]);
    for (const p of res.json()) expect(Object.keys(p).sort()).toEqual(["id", "name", "timezone"]);
  });

  it("shows one professional's profile and booking notice without an email", async () => {
    const m = await signup(mira);
    const member = await signup(leo);
    const res = await get(member.token, `/api/professionals/${m.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: m.id, name: mira.name, timezone: "Europe/London", minNoticeMinutes: 0 });
  });

  it.each([
    ["a member's id", "member"],
    ["an unknown uuid", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-uuid"],
  ])("answers 404 for %s on profile and slots", async (_name, which) => {
    const member = await signup(leo);
    const other = await signup(ana);
    const id = which === "member" ? other.id : which;
    for (const url of [`/api/professionals/${id}`, `/api/professionals/${id}/slots`]) {
      const res = await get(member.token, url);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
  });
});

describe("free slots", () => {
  const monMorning = [{ weekday: 1, start: "09:00", end: "12:00" }];

  async function setup() {
    const pro = await signup(mira);
    await putHours(pro.token, monMorning);
    return { pro, member: await signup(leo) };
  }

  it("returns the professional's hours as UTC instants on the next Mondays, 28 days at most", async () => {
    const { pro, member } = await setup();
    const res = await get(member.token, `/api/professionals/${pro.id}/slots`);
    expect(res.statusCode).toBe(200);
    const slots: { startsAt: string; endsAt: string }[] = res.json().slots;
    // January is GMT, so London 09:00-12:00 is the same in UTC: Jan 4, 11, 18, 25, three each.
    expect(slots).toHaveLength(12);
    expect(slots.slice(0, 3)).toEqual([
      { startsAt: "2027-01-04T09:00:00.000Z", endsAt: "2027-01-04T09:50:00.000Z" },
      { startsAt: "2027-01-04T10:00:00.000Z", endsAt: "2027-01-04T10:50:00.000Z" },
      { startsAt: "2027-01-04T11:00:00.000Z", endsAt: "2027-01-04T11:50:00.000Z" },
    ]);
    expect(slots[11]!.startsAt).toBe("2027-01-25T11:00:00.000Z");
    for (const s of slots) expect(Object.keys(s).sort()).toEqual(["endsAt", "startsAt"]);
  });

  it("offers nothing before now or at and beyond now + 28 days", async () => {
    const { pro, member } = await setup();
    nowIso = "2027-01-04T10:30:00.000Z";
    const first = (await get(member.token, `/api/professionals/${pro.id}/slots`)).json().slots;
    expect(first[0].startsAt).toBe("2027-01-04T11:00:00.000Z");

    // Window ends 2027-02-01T10:30Z; Feb 1 09:00 and 10:00 are inside it, 11:00 is not.
    const starts: string[] = first.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).toContain("2027-02-01T10:00:00.000Z");
    expect(starts).not.toContain("2027-02-01T11:00:00.000Z");
    for (const s of starts) {
      expect(new Date(s).getTime()).toBeGreaterThanOrEqual(new Date(nowIso).getTime());
      expect(new Date(s).getTime()).toBeLessThan(new Date(nowIso).getTime() + 28 * 24 * 3600_000);
    }
  });

  it("returns an empty list for a professional with no hours", async () => {
    const pro = await signup(ravi);
    const member = await signup(leo);
    const res = await get(member.token, `/api/professionals/${pro.id}/slots`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ slots: [] });
  });

  it("returns the same instants whatever the member's timezone", async () => {
    const { pro, member } = await setup();
    const other = await signup(ana);
    const a = await get(member.token, `/api/professionals/${pro.id}/slots`);
    const b = await get(other.token, `/api/professionals/${pro.id}/slots`);
    expect(a.json()).toEqual(b.json());
  });

  it("follows the professional's zone across a daylight saving change", async () => {
    // London springs forward on 2027-03-28: Monday 09:00 BST is 08:00 UTC.
    nowIso = "2027-03-29T00:00:00.000Z";
    const pro = await signup(mira);
    await putHours(pro.token, [{ weekday: 1, start: "09:00", end: "10:00" }]);
    const member = await signup(leo);
    const slots = (await get(member.token, `/api/professionals/${pro.id}/slots`)).json().slots;
    expect(slots[0]).toEqual({ startsAt: "2027-03-29T08:00:00.000Z", endsAt: "2027-03-29T08:50:00.000Z" });
  });
});

describe("slots on a member's own calendar days", () => {
  const eveningHours = [{ weekday: 1, start: "18:00", end: "20:00" }];

  // What the booking page does: take the API's instants and group them by the member's own days.
  async function daysSeenBy(memberBody: object, proId: string, until: string) {
    const member = await signup(memberBody);
    const slots: { startsAt: string; endsAt: string }[] = (await get(member.token, `/api/professionals/${proId}/slots`)).json().slots;
    const asDates = slots
      .filter((s) => s.startsAt < until)
      .map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) }));
    return groupSlotsByLocalDay(asDates, "Asia/Kolkata").map((g) => [g.day, g.slots.map((s) => s.startsAt.toISOString())]);
  }

  it("splits a London evening across two days for a member in Kolkata, at their local midnight", async () => {
    const pro = await signup(mira);
    await putHours(pro.token, eveningHours);
    // January: London is on GMT. 18:00Z is 23:30 in Kolkata on Monday; 19:00Z is 00:30 on Tuesday.
    expect(await daysSeenBy(priya, pro.id, "2027-01-05T00:00:00Z")).toEqual([
      ["2027-01-04", ["2027-01-04T18:00:00.000Z"]],
      ["2027-01-05", ["2027-01-04T19:00:00.000Z"]],
    ]);
  });

  it("keeps the same London evening on one Kolkata day once London is on summer time", async () => {
    nowIso = "2027-03-29T00:00:00.000Z";
    const pro = await signup(mira);
    await putHours(pro.token, eveningHours);
    // Monday 29 March is BST: 18:00 and 19:00 in London are 17:00Z and 18:00Z, 22:30 and 23:30 in Kolkata.
    expect(await daysSeenBy(priya, pro.id, "2027-03-30T00:00:00Z")).toEqual([
      ["2027-03-29", ["2027-03-29T17:00:00.000Z", "2027-03-29T18:00:00.000Z"]],
    ]);
  });
});

describe("access", () => {
  it("answers 403 to a professional and 401 to someone not signed in", async () => {
    const pro = await signup(mira);
    const urls = ["/api/professionals", `/api/professionals/${pro.id}`, `/api/professionals/${pro.id}/slots`];
    for (const url of urls) {
      expect((await get(pro.token, url)).statusCode).toBe(403);
      expect((await get(null, url)).statusCode).toBe(401);
    }
  });
});
