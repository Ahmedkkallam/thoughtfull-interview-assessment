import { Link } from "react-router";
import type { Slot } from "./Calendar.tsx";
import { dayParts, formatRange, formatTime, zoneLabel, zoneTitle } from "./format.ts";
import { ArrowRightIcon, Avatar, BellIcon, Button, buttonClass, CalendarIcon, ClockIcon } from "./ui.tsx";

const SESSION_MINUTES = 50;

// Desktop: a sticky panel beside the calendar that fills in as you pick: the day shown in the calendar at once, the
// time once one is chosen. Phones: once a time is chosen, the same
// element becomes a slim bar above the tab bar ("Tue 5 Jan · 00:00 — Continue"). One Continue, whatever the screen.
export function BookingSummary({
  professional,
  day,
  slot,
  timezone,
  href,
  moving,
}: {
  professional: string;
  day: string;
  slot: Slot | null;
  timezone: string;
  href: string | null;
  moving: boolean;
}) {
  const p = dayParts(day);
  const row = "flex items-start gap-3 py-3";
  return (
    <aside
      aria-labelledby="summary-title"
      className={`${
        slot
          ? "fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-3 flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-lg shadow-stone-900/10 backdrop-blur motion-safe:animate-rise"
          : "hidden"
      } lg:sticky lg:top-10 lg:inset-auto lg:z-auto lg:mx-0 lg:block lg:rounded-card lg:bg-white lg:p-6 lg:shadow-sm lg:backdrop-blur-none`}
    >
      <h2 id="summary-title" className="sr-only text-lg font-semibold text-stone-900 lg:not-sr-only">
        {moving ? "Your new time" : "Your session"}
      </h2>

      {/* Phone line. */}
      {slot && (
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 tabular-nums lg:hidden">
          {p.weekday} {p.day} {p.month} · {formatTime(slot.startsAt, timezone)}
        </p>
      )}

      {/* Desktop details. */}
      <div className="hidden lg:block">
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-sand-100 p-3">
          <Avatar name={professional} size="sm" />
          <p className="font-medium text-stone-900">{professional}</p>
        </div>
        <dl className="mt-2 divide-y divide-stone-100">
          <div className={row}>
            <CalendarIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
            <div>
              <dt className="text-xs text-stone-500">Day</dt>
              <dd className="font-medium text-stone-900">{p.long}</dd>
            </div>
          </div>
          <div className={row}>
            <ClockIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
            <div>
              <dt className="text-xs text-stone-500">Time</dt>
              <dd title={zoneTitle(timezone)} className="font-medium text-stone-900 tabular-nums">
                {slot ? `${formatRange(slot.startsAt, slot.endsAt, timezone)} (${zoneLabel(timezone)})` : "Choose a time"}
              </dd>
              <dd className="text-xs text-stone-500">{SESSION_MINUTES} minutes</dd>
            </div>
          </div>
        </dl>
        <p className={`${row} border-t border-stone-100 text-sm text-stone-600`}>
          <BellIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
          Reminders 24 hours and 1 hour before.
        </p>
      </div>

      {href ? (
        <Link to={href} className={`${buttonClass()} shrink-0 lg:mt-4 lg:w-full`}>
          Continue
          <ArrowRightIcon className="size-4" />
        </Link>
      ) : (
        <Button disabled className="lg:mt-4 lg:w-full">
          Continue
        </Button>
      )}
    </aside>
  );
}
