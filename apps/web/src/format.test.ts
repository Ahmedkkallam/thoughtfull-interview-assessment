import { expect, test } from "vitest";
import { formatDay, formatRange, formatTime } from "./format.ts";

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
