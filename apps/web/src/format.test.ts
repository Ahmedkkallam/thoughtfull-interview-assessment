import { expect, test } from "vitest";
import { addDays, dayParts, formatDay, formatRange, formatTime, weekStart, zoneLabel, zoneLongName, zoneOption } from "./format.ts";

test("half-hour zone (Asia/Kolkata) shows :30 and rolls into the next day", () => {
  const start = new Date("2027-01-04T20:00:00Z");
  expect(formatTime(start, "Asia/Kolkata")).toBe("01:30");
  expect(formatDay(start, "Asia/Kolkata")).toBe("Tue 5 Jan 2027");
  expect(formatRange(start, new Date("2027-01-04T20:50:00Z"), "Asia/Kolkata")).toBe("01:30–02:20");
});

test("midnight is 00:00 and London summer time is respected", () => {
  expect(formatTime(new Date("2027-01-04T16:00:00Z"), "Asia/Singapore")).toBe("00:00");
  expect(formatTime(new Date("2027-07-05T12:00:00Z"), "Europe/London")).toBe("13:00");
});

test("zones are named by their city", () => {
  expect(zoneLabel("America/New_York")).toBe("New York time");
  expect(zoneLabel("Asia/Singapore")).toBe("Singapore time");
  expect(zoneLabel("Asia/Kolkata")).toBe("Kolkata time");
  expect(zoneLabel("Europe/London")).toBe("London time");
  expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires time");
  expect(zoneLabel("UTC")).toBe("UTC");
});

test("the long zone name follows summer time", () => {
  const winter = new Date("2027-01-15T12:00:00Z");
  expect(zoneLongName("Europe/London", winter)).toBe("Greenwich Mean Time");
  expect(zoneLongName("Europe/London", new Date("2027-07-15T12:00:00Z"))).toBe("British Summer Time");
  expect(zoneLongName("America/New_York", winter)).toBe("Eastern Standard Time");
  expect(zoneLongName("Asia/Singapore", winter)).toBe("Singapore Standard Time");
  expect(zoneLongName("Asia/Kolkata", winter)).toBe("India Standard Time");
});

test("signup options show the city and keep the zone id", () => {
  expect(zoneOption("America/New_York")).toBe("New York (America/New_York)");
  expect(zoneOption("UTC")).toBe("UTC");
});

test("calendar days step across month, year and the clock change without drifting", () => {
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2027-03-27", 2)).toBe("2027-03-29"); // London clocks go forward on 28 March
  expect(weekStart("2027-01-05")).toBe("2027-01-04"); // Tuesday -> Monday
  expect(weekStart("2027-01-10")).toBe("2027-01-04"); // Sunday -> the Monday before
  expect(dayParts("2027-01-05")).toEqual({ weekday: "Tue", day: "5", month: "Jan", long: "Tuesday 5 January 2027" });
});
