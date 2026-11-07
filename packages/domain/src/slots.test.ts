import { describe, expect, it } from "vitest";
import { generateSlots, validateWeek, type Interval, type WorkingHours } from "./slots.ts";

const iso = (slots: Interval[]) => slots.map((s) => s.startsAt.toISOString());
const at = (s: string) => new Date(s);

// 2027-01-04 is a Monday; London is on GMT (UTC+0) all January, so local time equals UTC.
const MONDAY_9_TO_10: WorkingHours[] = [{ weekday: 1, start: "09:00", end: "10:00" }];
const london = (hours: WorkingHours[], extra: Partial<Parameters<typeof generateSlots>[0]> = {}) =>
  generateSlots({ hours, proZone: "Europe/London", now: at("2027-01-04T08:00:00Z"), windowDays: 1, ...extra });

describe("slot window", () => {
  it("includes a slot starting exactly now and excludes one starting exactly 28 days later", () => {
    const slots = generateSlots({ hours: MONDAY_9_TO_10, proZone: "Europe/London", now: at("2027-01-04T09:00:00Z") });
    expect(iso(slots)).toEqual([
      "2027-01-04T09:00:00.000Z",
      "2027-01-11T09:00:00.000Z",
      "2027-01-18T09:00:00.000Z",
      "2027-01-25T09:00:00.000Z",
    ]);
  });

  it("one millisecond later drops the slot now in the past and admits the one at the far edge", () => {
    const slots = generateSlots({ hours: MONDAY_9_TO_10, proZone: "Europe/London", now: at("2027-01-04T09:00:00.001Z") });
    expect(iso(slots)).toEqual([
      "2027-01-11T09:00:00.000Z",
      "2027-01-18T09:00:00.000Z",
      "2027-01-25T09:00:00.000Z",
      "2027-02-01T09:00:00.000Z",
    ]);
  });

  it("slots are 50 minutes long and start every hour from the range start", () => {
    const slots = london([{ weekday: 1, start: "09:00", end: "12:00" }]);
    expect(slots.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()])).toEqual([
      ["2027-01-04T09:00:00.000Z", "2027-01-04T09:50:00.000Z"],
      ["2027-01-04T10:00:00.000Z", "2027-01-04T10:50:00.000Z"],
      ["2027-01-04T11:00:00.000Z", "2027-01-04T11:50:00.000Z"],
    ]);
  });
});

describe("working ranges", () => {
  it("keeps a slot that ends exactly at the range end and drops one that would run past it", () => {
    expect(iso(london([{ weekday: 1, start: "09:00", end: "10:50" }]))).toEqual([
      "2027-01-04T09:00:00.000Z",
      "2027-01-04T10:00:00.000Z",
    ]);
    expect(iso(london([{ weekday: 1, start: "09:00", end: "10:49" }]))).toEqual(["2027-01-04T09:00:00.000Z"]);
  });

  it("a split day anchors each range at its own start", () => {
    const hours: WorkingHours[] = [
      { weekday: 1, start: "09:00", end: "11:00" },
      { weekday: 1, start: "13:30", end: "15:00" },
    ];
    expect(iso(london(hours))).toEqual([
      "2027-01-04T09:00:00.000Z",
      "2027-01-04T10:00:00.000Z",
      "2027-01-04T13:30:00.000Z",
    ]);
  });

  it("a blocked day offers nothing, other days are unaffected", () => {
    const hours: WorkingHours[] = [
      { weekday: 1, start: "09:00", end: "10:00" },
      { weekday: 2, start: "09:00", end: "10:00" },
    ];
    expect(iso(london(hours, { windowDays: 2, blockedDays: ["2027-01-04"] }))).toEqual(["2027-01-05T09:00:00.000Z"]);
  });

  it("uses the weekday in the professional's zone, not in UTC", () => {
    // Monday 07:00 in Singapore is Sunday 23:00 UTC.
    const slots = generateSlots({
      hours: [{ weekday: 1, start: "07:00", end: "08:00" }],
      proZone: "Asia/Singapore",
      now: at("2027-01-03T00:00:00Z"),
      windowDays: 2,
    });
    expect(iso(slots)).toEqual(["2027-01-03T23:00:00.000Z"]);
  });

  it("rejects an unknown timezone", () => {
    expect(() => generateSlots({ hours: MONDAY_9_TO_10, proZone: "Mars/Olympus", now: at("2027-01-04T08:00:00Z") })).toThrow(
      /Unknown timezone/,
    );
  });
});

describe("busy intervals and notice", () => {
  const hours: WorkingHours[] = [{ weekday: 1, start: "09:00", end: "11:00" }];

  it("a busy interval overlapping a slot by one minute removes it", () => {
    const busy = [{ startsAt: at("2027-01-04T08:00:00Z"), endsAt: at("2027-01-04T09:01:00Z") }];
    expect(iso(london(hours, { busy }))).toEqual(["2027-01-04T10:00:00.000Z"]);
  });

  it("a busy interval that only touches a slot's start or end leaves it free", () => {
    const busy = [
      { startsAt: at("2027-01-04T08:00:00Z"), endsAt: at("2027-01-04T09:00:00Z") },
      { startsAt: at("2027-01-04T09:50:00Z"), endsAt: at("2027-01-04T10:00:00Z") },
      { startsAt: at("2027-01-04T10:50:00Z"), endsAt: at("2027-01-04T12:00:00Z") },
    ];
    expect(iso(london(hours, { busy }))).toEqual(["2027-01-04T09:00:00.000Z", "2027-01-04T10:00:00.000Z"]);
  });

  it("minimum notice keeps a slot exactly at the cut-off and drops one a minute inside it", () => {
    expect(iso(london(hours, { minNoticeMin: 60 }))).toEqual(["2027-01-04T09:00:00.000Z", "2027-01-04T10:00:00.000Z"]);
    expect(iso(london(hours, { minNoticeMin: 61 }))).toEqual(["2027-01-04T10:00:00.000Z"]);
  });
});

describe("daylight saving changes", () => {
  it("New York spring forward skips 02:00, which does not exist", () => {
    // 2027-03-14 is a Sunday; clocks jump 02:00 EST -> 03:00 EDT.
    const slots = generateSlots({
      hours: [{ weekday: 7, start: "00:00", end: "04:00" }],
      proZone: "America/New_York",
      now: at("2027-03-13T00:00:00Z"),
      windowDays: 2,
    });
    expect(iso(slots)).toEqual([
      "2027-03-14T05:00:00.000Z", // 00:00 EST
      "2027-03-14T06:00:00.000Z", // 01:00 EST
      "2027-03-14T07:00:00.000Z", // 03:00 EDT
    ]);
  });

  it("New York fall back offers the repeated 01:00 once, at its second (standard time) occurrence", () => {
    // 2026-11-01 is a Sunday; 01:00-02:00 happens twice (EDT, then EST). Luxon resolves 01:00 to EST.
    const slots = generateSlots({
      hours: [{ weekday: 7, start: "00:00", end: "04:00" }],
      proZone: "America/New_York",
      now: at("2026-10-31T00:00:00Z"),
      windowDays: 2,
    });
    expect(iso(slots)).toEqual([
      "2026-11-01T04:00:00.000Z", // 00:00 EDT
      "2026-11-01T06:00:00.000Z", // 01:00 EST (01:00 EDT, 05:00Z, is not offered)
      "2026-11-01T07:00:00.000Z", // 02:00 EST
      "2026-11-01T08:00:00.000Z", // 03:00 EST
    ]);
  });

  it("London spring forward skips 01:00, and Monday 09:00 moves from 09:00Z to 08:00Z", () => {
    // Clocks jump 01:00 GMT -> 02:00 BST on Sunday 2027-03-28.
    const sunday = generateSlots({
      hours: [{ weekday: 7, start: "00:00", end: "03:00" }],
      proZone: "Europe/London",
      now: at("2027-03-27T00:00:00Z"),
      windowDays: 2,
    });
    expect(iso(sunday)).toEqual(["2027-03-28T00:00:00.000Z", "2027-03-28T01:00:00.000Z"]); // 00:00 GMT, 02:00 BST

    const mondays = generateSlots({
      hours: MONDAY_9_TO_10,
      proZone: "Europe/London",
      now: at("2027-03-21T00:00:00Z"),
      windowDays: 14,
    });
    expect(iso(mondays)).toEqual(["2027-03-22T09:00:00.000Z", "2027-03-29T08:00:00.000Z"]);
  });

  it("London fall back offers the repeated 01:00 once, at its second (GMT) occurrence", () => {
    // Clocks go back 02:00 BST -> 01:00 GMT on Sunday 2026-10-25.
    const slots = generateSlots({
      hours: [{ weekday: 7, start: "00:00", end: "03:00" }],
      proZone: "Europe/London",
      now: at("2026-10-24T00:00:00Z"),
      windowDays: 2,
    });
    expect(iso(slots)).toEqual([
      "2026-10-24T23:00:00.000Z", // 00:00 BST
      "2026-10-25T01:00:00.000Z", // 01:00 GMT (01:00 BST, 00:00Z, is not offered)
      "2026-10-25T02:00:00.000Z", // 02:00 GMT
    ]);
  });
});

describe("validateWeek", () => {
  it("accepts split days, touching ranges and the same hours on different weekdays", () => {
    expect(
      validateWeek([
        { weekday: 1, start: "09:00", end: "12:00" },
        { weekday: 1, start: "12:00", end: "17:00" },
        { weekday: 2, start: "09:00", end: "17:00" },
      ]),
    ).toEqual([]);
  });

  it("rejects an end that is not after the start", () => {
    expect(validateWeek([{ weekday: 1, start: "10:00", end: "10:00" }])).toHaveLength(1);
    expect(validateWeek([{ weekday: 1, start: "11:00", end: "10:00" }])).toHaveLength(1);
  });

  it("rejects a range crossing midnight", () => {
    expect(validateWeek([{ weekday: 5, start: "22:00", end: "02:00" }])[0]).toMatch(/crossing midnight/);
  });

  it("rejects badly formed times", () => {
    for (const bad of ["9:00", "24:00", "12:60", "noon", ""]) {
      expect(validateWeek([{ weekday: 1, start: bad, end: "23:00" }])[0], bad).toMatch(/HH:mm/);
    }
  });

  it("rejects a weekday outside 1 to 7", () => {
    expect(validateWeek([{ weekday: 0, start: "09:00", end: "10:00" }])[0]).toMatch(/weekday/);
    expect(validateWeek([{ weekday: 8, start: "09:00", end: "10:00" }])[0]).toMatch(/weekday/);
  });

  it("rejects overlapping ranges on the same weekday", () => {
    const problems = validateWeek([
      { weekday: 3, start: "13:00", end: "17:00" },
      { weekday: 3, start: "09:00", end: "13:01" },
    ]);
    expect(problems).toEqual(["weekday 3: 09:00-13:01 overlaps 13:00-17:00"]);
  });
});
