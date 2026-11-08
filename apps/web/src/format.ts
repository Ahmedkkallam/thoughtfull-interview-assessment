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
