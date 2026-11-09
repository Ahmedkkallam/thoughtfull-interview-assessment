import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";
import { Button, Callout, Card, CheckIcon, CrossIcon, inputClass, PageHeader, PlusIcon, Skeleton } from "./ui.tsx";

type Range = { start: string; end: string };
type Hours = { weekday: number; start: string; end: string };
type Week = Record<number, Range[]>;

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function toWeek(hours: Hours[]): Week {
  const week: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const h of hours) week[h.weekday]!.push({ start: h.start, end: h.end });
  return week;
}

function toHours(week: Week): Hours[] {
  return days.flatMap((_, i) => (week[i + 1] ?? []).map((r) => ({ weekday: i + 1, ...r })));
}

export function Availability() {
  const me = useOutletContext<Me>();
  // The API refuses members too; this just avoids showing them a useless editor.
  if (me.role !== "professional") return <Card className="text-stone-700">This page is for professionals.</Card>;
  return <Editor timezone={me.timezone} />;
}

function Editor({ timezone }: { timezone: string }) {
  const saved = useQuery({ queryKey: ["availability"], queryFn: () => api<Hours[]>("/api/availability") });
  if (saved.isPending) return <Skeleton rows={4} />;
  if (saved.isError) return <Callout>Could not load your hours: {saved.error.message}</Callout>;
  return <WeekForm timezone={timezone} initial={saved.data} />;
}

// Starts from the saved week once; after a save the form already matches what the server holds.
function WeekForm({ timezone, initial }: { timezone: string; initial: Hours[] }) {
  const queryClient = useQueryClient();
  const [week, setWeek] = useState<Week>(() => toWeek(initial));
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
  const change = (day: number, i: number, field: keyof Range, value: string) =>
    edit({ ...week, [day]: week[day]!.map((r, j) => (j === i ? { ...r, [field]: value } : r)) });

  return (
    <>
      <PageHeader title="My working hours" subtitle={`Times are in your timezone (${timezone}). Members book sessions inside these hours.`} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          save.mutate(toHours(week));
        }}
      >
        {days.map((name, idx) => {
          const day = idx + 1;
          const ranges = week[day]!;
          return (
            <fieldset key={day} className="rounded-card border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
              <legend className="sr-only">{name}</legend>
              {/* The legend stays for screen readers; this is the visible heading row. */}
              <div aria-hidden="true" className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-stone-900">{name}</span>
                {ranges.length === 0 && <span className="text-sm text-stone-500">Not working</span>}
              </div>
              {ranges.length === 0 && <p className="sr-only">No hours</p>}
              <div className="space-y-2">
                {ranges.map((r, i) => {
                  const backwards = r.start !== "" && r.end !== "" && r.end <= r.start;
                  return (
                    <div key={i} className="flex flex-wrap items-end gap-3 rounded-xl bg-sand-50 p-3 motion-safe:animate-fade">
                      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
                        <span>
                          <span className="sr-only">{name} range {i + 1}</span>{" "}
                          <span className="capitalize">start</span>
                        </span>
                        <input type="time" value={r.start} onChange={(e) => change(day, i, "start", e.target.value)} required className={`${inputClass} w-32 tabular-nums`} />
                      </label>
                      <span aria-hidden="true" className="pb-3 text-stone-400">–</span>
                      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
                        <span>
                          <span className="sr-only">{name} range {i + 1}</span>{" "}
                          <span className="capitalize">end</span>
                        </span>
                        <input
                          type="time"
                          value={r.end}
                          onChange={(e) => change(day, i, "end", e.target.value)}
                          required
                          aria-invalid={backwards}
                          className={`${inputClass} w-32 tabular-nums`}
                        />
                      </label>
                      <Button variant="ghost" size="sm" className="ml-auto text-stone-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => edit({ ...week, [day]: ranges.filter((_, j) => j !== i) })}>
                        <CrossIcon className="size-4" />
                        Remove{" "}<span className="sr-only">{name} range {i + 1}</span>
                      </Button>
                      {backwards && <p className="basis-full text-sm text-rose-700">End must be after start.</p>}
                    </div>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => edit({ ...week, [day]: [...ranges, { start: "09:00", end: "17:00" }] })}>
                <PlusIcon className="size-4" />
                Add hours{" "}<span className="sr-only">for {name}</span>
              </Button>
            </fieldset>
          );
        })}
        {/* Stays in view while scrolling the week, so saving is always one click away. */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-card border border-stone-200/80 bg-white/90 p-3 shadow-lg shadow-stone-900/5 backdrop-blur">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save week"}
          </Button>
          {done && (
            <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 motion-safe:animate-fade">
              <CheckIcon className="size-4" />
              Saved
            </p>
          )}
          {save.isError && (
            <div className="basis-full">
              <Callout>{save.error.message}</Callout>
            </div>
          )}
        </div>
      </form>
    </>
  );
}
