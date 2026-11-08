import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";

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
  if (me.role !== "professional") return <p>This page is for professionals.</p>;
  return <Editor timezone={me.timezone} />;
}

function Editor({ timezone }: { timezone: string }) {
  const saved = useQuery({ queryKey: ["availability"], queryFn: () => api<Hours[]>("/api/availability") });
  if (saved.isPending) return <p role="status">Loading…</p>;
  if (saved.isError) return <p role="alert">Could not load your hours: {saved.error.message}</p>;
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
      <h1>My working hours</h1>
      <p>Times are in your timezone ({timezone}). Members book sessions inside these hours.</p>
      <form
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
            <fieldset key={day}>
              <legend>{name}</legend>
              {ranges.length === 0 && <p>No hours</p>}
              {ranges.map((r, i) => {
                const backwards = r.start !== "" && r.end !== "" && r.end <= r.start;
                return (
                  <div key={i} className="range">
                    <label>
                      {name} range {i + 1} start
                      <input type="time" value={r.start} onChange={(e) => change(day, i, "start", e.target.value)} required />
                    </label>
                    <label>
                      {name} range {i + 1} end
                      <input
                        type="time"
                        value={r.end}
                        onChange={(e) => change(day, i, "end", e.target.value)}
                        required
                        aria-invalid={backwards}
                      />
                    </label>
                    <button type="button" onClick={() => edit({ ...week, [day]: ranges.filter((_, j) => j !== i) })}>
                      Remove {name} range {i + 1}
                    </button>
                    {backwards && <p className="error">End must be after start.</p>}
                  </div>
                );
              })}
              <button type="button" onClick={() => edit({ ...week, [day]: [...ranges, { start: "09:00", end: "17:00" }] })}>
                Add hours for {name}
              </button>
            </fieldset>
          );
        })}
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save week"}
        </button>
        {done && <p role="status">Saved</p>}
        {save.isError && <p role="alert">{save.error.message}</p>}
      </form>
    </>
  );
}
