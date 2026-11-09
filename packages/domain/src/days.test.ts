import { describe, expect, it } from "vitest";
import { daysBetween, localDay, localDayBounds } from "./days.ts";

describe("local calendar days", () => {
  it("names the local date of an instant in the given zone, not in UTC", () => {
    // London Monday 16:00 is already Tuesday in Singapore.
    expect(localDay(new Date("2027-01-11T16:00:00Z"), "Europe/London")).toBe("2027-01-11");
    expect(localDay(new Date("2027-01-11T16:00:00Z"), "Asia/Singapore")).toBe("2027-01-12");
    // Half-hour zone: Kolkata midnight is 18:30 UTC.
    expect(localDay(new Date("2027-01-04T18:29:59Z"), "Asia/Kolkata")).toBe("2027-01-04");
    expect(localDay(new Date("2027-01-04T18:30:00Z"), "Asia/Kolkata")).toBe("2027-01-05");
  });

  it("gives a normal day 24 hours, local midnight to local midnight", () => {
    const { startsAt, endsAt } = localDayBounds("2027-01-11", "Asia/Singapore");
    expect(startsAt.toISOString()).toBe("2027-01-10T16:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2027-01-11T16:00:00.000Z");
  });

  it("gives the spring-forward day in London 23 hours and the fall-back day in New York 25", () => {
    const spring = localDayBounds("2027-03-28", "Europe/London");
    expect(spring.startsAt.toISOString()).toBe("2027-03-28T00:00:00.000Z"); // midnight GMT
    expect(spring.endsAt.toISOString()).toBe("2027-03-28T23:00:00.000Z"); // midnight BST
    const fall = localDayBounds("2026-11-01", "America/New_York");
    expect(fall.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // midnight EDT
    expect(fall.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // midnight EST
  });

  it("counts calendar days between two dates, across a clock change and a leap day", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-11-09", "2027-11-09")).toBe(365);
    expect(daysBetween("2027-01-12", "2027-01-11")).toBe(-1);
  });

  it("rejects an unknown timezone and a malformed date", () => {
    expect(() => localDay(new Date(), "Mars/Olympus")).toThrow();
    expect(() => localDayBounds("2027-02-30", "Europe/London")).toThrow();
    expect(() => daysBetween("2027-1-1", "2027-01-02")).toThrow();
  });
});
