import { DateTime, IANAZone } from "luxon";
import type { Interval } from "./slots.ts";

// Calendar-day helpers for blocked dates, which are local dates ("yyyy-MM-dd") in the professional's zone.

function zoneOrThrow(zone: string): string {
  if (!IANAZone.isValidZone(zone)) throw new Error(`Unknown timezone: ${zone}`);
  return zone;
}

function dateOrThrow(day: string, zone = "UTC"): DateTime {
  const dt = DateTime.fromFormat(day, "yyyy-MM-dd", { zone });
  if (!dt.isValid) throw new Error(`Not a date: ${day}`);
  return dt;
}

/** The local calendar date of an instant in a zone. */
export function localDay(at: Date, zone: string): string {
  return DateTime.fromJSDate(at, { zone: zoneOrThrow(zone) }).toISODate()!;
}

/** Local midnight to the next local midnight, in absolute time: 23 or 25 hours on a clock-change day. */
export function localDayBounds(day: string, zone: string): Interval {
  const start = dateOrThrow(day, zoneOrThrow(zone));
  return { startsAt: start.toJSDate(), endsAt: start.plus({ days: 1 }).toJSDate() };
}

/** Calendar days from one date to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  // In UTC every day is 24 hours, so the difference is a whole number of days.
  return dateOrThrow(to).diff(dateOrThrow(from), "days").days;
}
