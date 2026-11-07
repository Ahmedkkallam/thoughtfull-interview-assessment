import { describe, expect, it } from "vitest";
import { groupSlotsByLocalDay } from "./display.ts";
import { generateSlots } from "./slots.ts";

const slot = (iso: string) => ({ startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 50 * 60_000) });
const days = (groups: { day: string; slots: { startsAt: Date }[] }[]) =>
  groups.map((g) => [g.day, g.slots.map((s) => s.startsAt.toISOString())]);

describe("grouping slots by the viewer's local day", () => {
  it("a London Monday 16:00 slot appears under Tuesday for a Singapore member", () => {
    const slots = generateSlots({
      hours: [{ weekday: 1, start: "16:00", end: "17:00" }],
      proZone: "Europe/London",
      now: new Date("2027-01-03T00:00:00Z"),
      windowDays: 7,
    });
    expect(days(groupSlotsByLocalDay(slots, "Asia/Singapore"))).toEqual([["2027-01-05", ["2027-01-04T16:00:00.000Z"]]]);
    expect(days(groupSlotsByLocalDay(slots, "Europe/London"))).toEqual([["2027-01-04", ["2027-01-04T16:00:00.000Z"]]]);
  });

  it("splits days at local midnight in a half-hour zone (Asia/Kolkata, UTC+5:30)", () => {
    const slots = [slot("2027-01-04T18:29:00Z"), slot("2027-01-04T18:30:00Z"), slot("2027-01-04T20:00:00Z")];
    expect(days(groupSlotsByLocalDay(slots, "Asia/Kolkata"))).toEqual([
      ["2027-01-04", ["2027-01-04T18:29:00.000Z"]],
      ["2027-01-05", ["2027-01-04T18:30:00.000Z", "2027-01-04T20:00:00.000Z"]],
    ]);
  });

  it("returns no groups for no slots and rejects an unknown timezone", () => {
    expect(groupSlotsByLocalDay([], "Asia/Singapore")).toEqual([]);
    expect(() => groupSlotsByLocalDay([], "Not/AZone")).toThrow(/Unknown timezone/);
  });
});
