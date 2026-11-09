import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SESSION_MINUTES } from "@thoughtfull/domain";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";
import { Bone, Button, Callout, Card, CheckIcon, ChevronDownIcon, CopyIcon, CrossIcon, Loading, PageHeader, PlusIcon, SwitchTrack, Zone } from "./ui.tsx";

type Range = { start: string; end: string };
export type Hours = { weekday: number; start: string; end: string };
type Week = Record<number, Range[]>;

export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_RANGE: Range = { start: "09:00", end: "17:00" };

function toWeek(hours: Hours[]): Week {
  const week: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const h of hours) week[h.weekday]!.push({ start: h.start, end: h.end });
  return week;
}

function toHours(week: Week): Hours[] {
  return weekdays.flatMap((_, i) => (week[i + 1] ?? []).map((r) => ({ weekday: i + 1, ...r })));
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// A preview for an ordinary day: sessions start on the hour from the range start and must end inside it (the same
// grid the server uses). Bookings, blocked days and clock changes are the server's business; this is only a hint.
function sessionsIn(ranges: Range[]): number {
  return ranges.reduce((sum, r) => {
    const length = minutes(r.end) - minutes(r.start);
    return sum + (r.start && r.end && length >= SESSION_MINUTES ? Math.floor((length - SESSION_MINUTES) / 60) + 1 : 0);
  }, 0);
}

// "09:00–12:00, 13:00–17:00 · 7 sessions"
export function daySummary(ranges: Range[]): string | null {
  if (ranges.length === 0) return null;
  const n = sessionsIn(ranges);
  return `${ranges.map((r) => `${r.start}–${r.end}`).join(", ")} · ${n} ${n === 1 ? "session" : "sessions"}`;
}

export function Availability() {
  const me = useOutletContext<Me>();
  // The API refuses members too; this just avoids showing them a useless editor.
  if (me.role !== "professional") return <Card className="text-stone-700">This page is for professionals.</Card>;
  return <Editor timezone={me.timezone} />;
}

function Editor({ timezone }: { timezone: string }) {
  const saved = useQuery({ queryKey: ["availability"], queryFn: () => api<Hours[]>("/api/availability") });
  const header = (
    <PageHeader
      title="My working hours"
      subtitle={
        <>
          Members book sessions inside these hours. <Zone prefix="Hours are in " zone={timezone} long />
        </>
      }
    />
  );
  if (saved.isPending)
    return (
      <>
        {header}
        <Loading className="mx-auto max-w-3xl divide-y divide-stone-100 rounded-card border border-stone-200/80 bg-white">
          {weekdays.map((d) => (
            <div key={d} className="flex items-center gap-4 p-5">
              <Bone className="h-6 w-11 rounded-full" />
              <Bone className="h-4 w-24" />
              <Bone className="h-4 flex-1" />
            </div>
          ))}
        </Loading>
      </>
    );
  if (saved.isError)
    return (
      <>
        {header}
        <Callout>Could not load your hours: {saved.error.message}</Callout>
      </>
    );
  return (
    <>
      {header}
      <WeekForm initial={saved.data} />
    </>
  );
}

// Starts from the saved week once; after a save the form already matches what the server holds.
function WeekForm({ initial }: { initial: Hours[] }) {
  const queryClient = useQueryClient();
  const [week, setWeek] = useState<Week>(() => toWeek(initial));
  // One day open at a time: the first day with hours, or Monday.
  const [open, setOpen] = useState<number | null>(() => initial[0]?.weekday ?? 1);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: (hours: Hours[]) =>
      api<Hours[]>("/api/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      }),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const edit = (next: Week) => {
    setWeek(next);
    setDone(false);
    save.reset();
  };
  const setDay = (day: number, ranges: Range[]) => edit({ ...week, [day]: ranges });
  const change = (day: number, i: number, field: keyof Range, value: string) =>
    setDay(day, week[day]!.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const toggle = (day: number) => {
    if (week[day]!.length > 0) return setDay(day, []);
    setDay(day, [DEFAULT_RANGE]);
    setOpen(day);
  };
  // Monday to Friday get a copy of this day's ranges; the weekend is left alone.
  const copyToWeekdays = (day: number) => edit({ ...week, 1: [...week[day]!], 2: [...week[day]!], 3: [...week[day]!], 4: [...week[day]!], 5: [...week[day]!] });

  const hours = toHours(week);
  const workingDays = weekdays.filter((_, i) => week[i + 1]!.length > 0).length;
  const weekly = weekdays.reduce((n, _, i) => n + sessionsIn(week[i + 1]!), 0);

  return (
    <form
      className="mx-auto max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        save.mutate(hours);
      }}
    >
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-card border border-stone-200/80 bg-white shadow-sm">
        {weekdays.map((name, idx) => {
          const day = idx + 1;
          const ranges = week[day]!;
          const on = ranges.length > 0;
          const expanded = open === day;
          const panelId = `day-${day}-panel`;
          return (
            <li key={day}>
              {/* Fieldsets default to min-width: min-content, which would push the row wider than a phone. */}
              <fieldset className="min-w-0">
                <legend className="sr-only">{name}</legend>
                <div className="flex items-center gap-3 px-4 sm:gap-4 sm:px-5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Available on ${name}`}
                    onClick={() => toggle(day)}
                    className="group inline-flex size-11 shrink-0 items-center justify-center rounded-full"
                  >
                    <SwitchTrack on={on} />
                  </button>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen(expanded ? null : day)}
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl py-3 text-left sm:gap-4"
                  >
                    {/* Phones: the summary sits under the day name; wider screens: beside it. */}
                    <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-4">
                      <span className="shrink-0 font-semibold text-stone-900 sm:w-24">{name}</span>{" "}
                      <span className={`min-w-0 truncate text-sm tabular-nums sm:flex-1 ${on ? "text-stone-700" : "text-stone-400"}`}>
                        {daySummary(ranges) ?? "Unavailable"}
                      </span>
                    </span>
                    <ChevronDownIcon className={`size-5 shrink-0 text-stone-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {/* The 0fr -> 1fr grid row animates the height; closed panels are inert and hidden from screen readers. */}
                <div
                  id={panelId}
                  inert={!expanded}
                  aria-hidden={!expanded}
                  className={`grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-200 ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-2 px-4 pb-4 sm:pl-20 sm:pr-5">
                      {ranges.map((r, i) => {
                        const backwards = r.start !== "" && r.end !== "" && r.end <= r.start;
                        return (
                          <div key={i} className="rounded-xl bg-sand-50 p-2">
                            <div className="flex items-center gap-2">
                              <label className="min-w-0 flex-1 sm:flex-none">
                                <span className="sr-only">
                                  {name} range {i + 1} start
                                </span>
                                <input
                                  type="time"
                                  value={r.start}
                                  onChange={(e) => change(day, i, "start", e.target.value)}
                                  required
                                  className="block min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-stone-900 tabular-nums max-sm:px-1.5 max-sm:text-sm hover:border-stone-400 focus:border-brand-600 sm:w-32 sm:px-3"
                                />
                              </label>
                              <span aria-hidden="true" className="text-stone-400">
                                –
                              </span>
                              <label className="min-w-0 flex-1 sm:flex-none">
                                <span className="sr-only">
                                  {name} range {i + 1} end
                                </span>
                                <input
                                  type="time"
                                  value={r.end}
                                  onChange={(e) => change(day, i, "end", e.target.value)}
                                  required
                                  aria-invalid={backwards}
                                  className="block min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-stone-900 tabular-nums max-sm:px-1.5 max-sm:text-sm hover:border-stone-400 focus:border-brand-600 aria-invalid:border-rose-600 aria-invalid:bg-rose-50 sm:w-32 sm:px-3"
                                />
                              </label>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-11 shrink-0 px-0 text-stone-500 hover:bg-rose-50 hover:text-rose-700 sm:ml-auto"
                                onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}
                              >
                                <CrossIcon className="size-4" />
                                <span className="sr-only">
                                  Remove {name} range {i + 1}
                                </span>
                              </Button>
                            </div>
                            {backwards && <p className="mt-1 px-1 text-sm text-rose-700">End must be after start.</p>}
                          </div>
                        );
                      })}
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDay(day, [...ranges, DEFAULT_RANGE])}>
                          <PlusIcon className="size-4" />
                          Add hours{" "}<span className="sr-only">for {name}</span>
                        </Button>
                        {on && (
                          <Button variant="ghost" size="sm" className="text-stone-600" onClick={() => copyToWeekdays(day)}>
                            <CopyIcon className="size-4" />
                            Copy to all weekdays{" "}<span className="sr-only">from {name}</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>

      {/* Stays in view while scrolling the week (above the phone tab bar), so saving is always one click away. */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-card border border-stone-200/80 bg-white/90 p-3 shadow-lg shadow-stone-900/5 backdrop-blur lg:bottom-6">
        <p className="mr-auto pl-2 text-sm text-stone-600 tabular-nums">
          {workingDays} {workingDays === 1 ? "day" : "days"} · {weekly} sessions a week
        </p>
        {done && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 motion-safe:animate-fade">
            <CheckIcon className="size-4" />
            Saved
          </p>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save week"}
        </Button>
        {save.isError && (
          <div className="basis-full">
            <Callout>{save.error.message}</Callout>
          </div>
        )}
      </div>
    </form>
  );
}
