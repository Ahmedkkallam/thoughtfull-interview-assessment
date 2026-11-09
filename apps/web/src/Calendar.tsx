import { useState } from "react";
import { useSearchParams } from "react-router";
import { addDays, dayParts, formatRange, formatZoneName, weekStart } from "./format.ts";
import { ArrowLeftIcon, ArrowRightIcon, Button } from "./ui.tsx";

export type Slot = { startsAt: Date; endsAt: Date; iso: string };
export type SlotDay = { day: string; slots: Slot[] };

// The chosen day lives in the URL (?day=) so Back returns to it; an unknown or missing day falls back to the first
// day with free times. The page works it out, so the calendar and the summary always name the same day.
export function shownDayOf(days: SlotDay[], asked: string | null): string {
  return asked && days.some((d) => d.day === asked) ? asked : days[0]!.day;
}

// One week of days at a time, then the chosen day's times. Weeks run from the first to the last day the API
// returned slots for, so the browser's clock never decides what is shown. Choosing a day keeps other params
// (reschedule=). Picking a time only selects it; the summary continues.
export function SlotCalendar({
  days,
  shownDay,
  timezone,
  selected,
  onSelect,
}: {
  days: SlotDay[];
  shownDay: string;
  timezone: string;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const setParams = useSearchParams()[1];
  const byDay = new Map(days.map((d) => [d.day, d.slots]));
  const daySlots = byDay.get(shownDay)!;
  // Prev/next only move the view; choosing a day snaps the view back to that day's week.
  const [viewed, setViewed] = useState<string | null>(null);
  const week = viewed ?? weekStart(shownDay);
  const firstWeek = weekStart(days[0]!.day);
  const lastWeek = weekStart(days.at(-1)!.day);
  const from = dayParts(week);
  const to = dayParts(addDays(week, 6));

  const choose = (day: string) => {
    setViewed(null);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("day", day);
      return next;
    });
  };

  return (
    // Card look with tighter padding, so seven days fit side by side on a 375 px phone.
    <div className="rounded-card border border-stone-200/80 bg-white shadow-sm">
      <div className="space-y-3 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="w-11" aria-label="Previous week" disabled={week <= firstWeek} onClick={() => setViewed(addDays(week, -7))}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <p className="text-sm font-semibold text-stone-800 tabular-nums">
            {from.day} {from.month} – {to.day} {to.month}
          </p>
          <Button variant="ghost" size="sm" className="w-11" aria-label="Next week" disabled={week >= lastWeek} onClick={() => setViewed(addDays(week, 7))}>
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
        <div role="group" aria-label="Choose a day" key={week} className="grid grid-cols-7 gap-1 motion-safe:animate-fade sm:gap-2">
          {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((day) => {
            const count = byDay.get(day)?.length ?? 0;
            const p = dayParts(day);
            const on = day === shownDay;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                disabled={count === 0}
                aria-label={`${p.long}, ${count === 0 ? "no free times" : `${count} free ${count === 1 ? "time" : "times"}`}`}
                onClick={() => choose(day)}
                className={`flex min-h-11 flex-col items-center rounded-xl border px-0.5 py-2 leading-tight transition duration-150 disabled:cursor-not-allowed ${
                  on
                    ? "border-brand-700 bg-brand-700 text-white shadow-sm"
                    : count === 0
                      ? "border-transparent bg-stone-100/70 text-stone-400"
                      : "border-brand-200 bg-white text-stone-800 hover:border-brand-500 hover:bg-brand-50"
                }`}
              >
                <span className="text-[11px] font-medium uppercase">{p.weekday}</span>
                <span className="text-lg font-semibold tabular-nums">{p.day}</span>
                <span className="text-[11px]">{p.month}</span>
                <span className={`mt-1 text-[11px] whitespace-nowrap ${on ? "text-brand-50" : count === 0 ? "" : "font-medium text-brand-700"}`}>
                  {count === 0 ? "–" : `${count} free`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section aria-labelledby="slots-day" className="space-y-3 border-t border-stone-100 p-3 sm:p-5">
        {/* aria-live so screen readers hear the new day when the choice changes. */}
        <h2 id="slots-day" aria-live="polite" className="font-semibold text-stone-900">
          {dayParts(shownDay).long}
        </h2>
        <ul key={shownDay} className="grid grid-cols-2 gap-2 motion-safe:animate-fade sm:grid-cols-3 xl:grid-cols-4">
          {daySlots.map((s) => {
            const label = formatRange(s.startsAt, s.endsAt, timezone);
            // Clocks going back repeat an hour; name the zone on repeated labels so the two stay distinguishable.
            const repeated = daySlots.filter((o) => formatRange(o.startsAt, o.endsAt, timezone) === label).length > 1;
            const on = s.iso === selected;
            return (
              <li key={s.iso}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(s.iso)}
                  className={`flex min-h-11 w-full items-center justify-center rounded-xl border px-3 text-sm font-medium tabular-nums shadow-xs transition duration-150 active:scale-[0.98] ${
                    on
                      ? "border-brand-700 bg-brand-700 text-white shadow-sm"
                      : "border-brand-200 bg-white text-brand-800 hover:border-brand-500 hover:bg-brand-50 hover:shadow-sm motion-safe:hover:-translate-y-0.5"
                  }`}
                >
                  {repeated ? `${label} ${formatZoneName(s.startsAt, timezone)}` : label}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
