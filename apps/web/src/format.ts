// All display goes through the member's IANA zone, never the browser's and never manual offsets.
function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

// "Tue 12 Nov 2026"
export function formatDay(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

// "14:00" (24-hour, so there is no am/pm to misread)
export function formatTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

export function formatRange(start: Date, end: Date, timeZone: string): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`;
}

// "EDT" / "EST": only used to tell apart two slots with the same local label when the clocks go back.
export function formatZoneName(date: Date, timeZone: string): string {
  // en-US gives "EDT"; en-GB would give "GMT-4".
  const p = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date);
  return p.find((x) => x.type === "timeZoneName")?.value ?? "";
}

// "America/New_York" -> "New York time": the city people recognise; the IANA name stays in a title attribute.
export function zoneLabel(timeZone: string): string {
  if (!timeZone.includes("/")) return timeZone; // "UTC"
  if (timeZone.startsWith("Etc/")) return zoneLongName(timeZone); // "Etc/GMT+5" means UTC-5, so its own name would mislead
  return `${timeZone.split("/").at(-1)!.replaceAll("_", " ")} time`;
}

// "Singapore Standard Time"; depends on the date because of summer time ("British Summer Time").
export function zoneLongName(timeZone: string, at: Date = new Date()): string {
  return parts(at, timeZone, { timeZoneName: "long" }).timeZoneName ?? timeZone;
}

// Tooltip text: "Asia/Singapore · Singapore Standard Time".
export function zoneTitle(timeZone: string): string {
  return `${timeZone} · ${zoneLongName(timeZone)}`;
}

// Signup option text: "New York (America/New_York)".
export function zoneOption(timeZone: string): string {
  return timeZone.includes("/") ? `${timeZone.split("/").at(-1)!.replaceAll("_", " ")} (${timeZone})` : timeZone;
}

// ---- calendar days ("2027-01-05"): plain dates with no zone, so UTC arithmetic on them is safe ----
const toUtc = (day: string) => new Date(`${day}T12:00:00Z`);

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The Monday on or before the day (weeks start on Monday, as in the hours editor).
export function weekStart(day: string): string {
  return addDays(day, -((toUtc(day).getUTCDay() + 6) % 7));
}

// { weekday: "Tue", day: "5", month: "Jan", long: "Tuesday 5 January 2027", dayMonth: "5 January" }
export function dayParts(day: string) {
  const short = parts(toUtc(day), "UTC", { weekday: "short", day: "numeric", month: "short" });
  const long = parts(toUtc(day), "UTC", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return {
    weekday: short.weekday!,
    day: short.day!,
    month: short.month!,
    long: `${long.weekday} ${long.day} ${long.month} ${long.year}`,
    dayMonth: `${long.day} ${long.month}`,
  };
}

// A booking-notice length: 60 -> "1 hour", 120 -> "2 hours", 30 -> "30 minutes".
export function noticeLabel(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const h = minutes / 60;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

// The calendar day ("2027-01-05") an instant falls on in a zone: used to group sessions and notifications by day.
export function localDay(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

// "in 3 hours", "tomorrow", "in 4 days": a friendly hint next to the exact time, never instead of it.
export function relativeTime(date: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
