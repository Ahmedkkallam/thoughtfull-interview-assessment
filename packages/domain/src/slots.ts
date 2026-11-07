import { DateTime, IANAZone } from "luxon";
import { SESSION_MINUTES } from "./constants.ts";

/** One working range on an ISO weekday (1 = Monday), in the professional's local wall-clock time. */
export interface WorkingHours {
  weekday: number;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

/** A half-open interval [startsAt, endsAt) in absolute time. */
export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface GenerateSlotsInput {
  hours: WorkingHours[];
  proZone: string;
  blockedDays?: string[]; // "yyyy-MM-dd", local dates in the professional's zone
  busy?: Interval[];
  now: Date;
  windowDays?: number;
  minNoticeMin?: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

export function generateSlots({
  hours,
  proZone,
  blockedDays = [],
  busy = [],
  now,
  windowDays = 28,
  minNoticeMin = 0,
}: GenerateSlotsInput): Interval[] {
  if (!IANAZone.isValidZone(proZone)) throw new Error(`Unknown timezone: ${proZone}`);

  // The window is absolute time, so it is the same for every viewer.
  const earliest = now.getTime() + minNoticeMin * MINUTE_MS;
  const windowEnd = now.getTime() + windowDays * DAY_MS;
  const blocked = new Set(blockedDays);
  const slots: Interval[] = [];

  // Walk the professional's local calendar dates that the window touches.
  const lastDay = DateTime.fromMillis(windowEnd, { zone: proZone }).startOf("day");
  for (
    let day = DateTime.fromJSDate(now, { zone: proZone }).startOf("day");
    day <= lastDay;
    day = day.plus({ days: 1 })
  ) {
    if (blocked.has(day.toISODate()!)) continue;

    for (const range of hours.filter((h) => h.weekday === day.weekday)) {
      const endMin = toMinutes(range.end);
      const rangeEnd = localTime(day, endMin, proZone).toMillis();

      // Steps are 60 wall-clock minutes from the range start, so times stay on the hour grid.
      for (let m = toMinutes(range.start); m < endMin; m += 60) {
        const local = localTime(day, m, proZone);
        // Spring forward: Luxon moves a missing local time forward, so a changed hour/minute means it does not exist.
        if (local.hour * 60 + local.minute !== m) continue;

        const start = local.toMillis();
        const end = start + SESSION_MINUTES * MINUTE_MS; // absolute minutes, even across a DST change
        if (end > rangeEnd || start < earliest || start >= windowEnd) continue;
        if (busy.some((b) => start < b.endsAt.getTime() && b.startsAt.getTime() < end)) continue;

        slots.push({ startsAt: new Date(start), endsAt: new Date(end) });
      }
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// Builds a wall-clock time on a local date. For a repeated time (fall back) Luxon picks one occurrence, so it is offered once.
function localTime(day: DateTime, minutes: number, zone: string): DateTime {
  return DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    { zone },
  );
}

/** Checks a weekly schedule. Returns one message per problem; an empty list means it is valid. */
export function validateWeek(hours: WorkingHours[]): string[] {
  const problems: string[] = [];
  const valid: WorkingHours[] = [];

  for (const h of hours) {
    const label = `weekday ${h.weekday} ${h.start}-${h.end}`;
    if (!Number.isInteger(h.weekday) || h.weekday < 1 || h.weekday > 7) {
      problems.push(`${label}: weekday must be 1 (Monday) to 7 (Sunday)`);
    } else if (!HH_MM.test(h.start) || !HH_MM.test(h.end)) {
      problems.push(`${label}: times must be HH:mm between 00:00 and 23:59`);
    } else if (toMinutes(h.end) <= toMinutes(h.start)) {
      // Ranges stay inside one local date, which keeps the DST handling per day.
      problems.push(`${label}: end must be after start on the same day (no crossing midnight)`);
    } else {
      valid.push(h);
    }
  }

  const sorted = [...valid].sort((a, b) => a.weekday - b.weekday || toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    // Touching ranges (12:00-13:00 then 13:00-14:00) are fine; only a real overlap is a problem.
    if (prev.weekday === cur.weekday && toMinutes(cur.start) < toMinutes(prev.end)) {
      problems.push(`weekday ${cur.weekday}: ${prev.start}-${prev.end} overlaps ${cur.start}-${cur.end}`);
    }
  }

  return problems;
}
