import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "./api.ts";
import { postJson } from "./auth.ts";
import { addDays, dayParts, localDay } from "./format.ts";
import { Bone, Button, Callout, Card, CalendarIcon, CrossIcon, Field, inputClass, Loading, PlusIcon, stagger } from "./ui.tsx";

// `day` is a plain date in the professional's own zone; the server decides which slots it removes.
export type BlockedDay = { day: string; reason: string | null; bookedSessions: number };

export function useBlockedDates() {
  return useQuery({ queryKey: ["blocked-dates"], queryFn: () => api<BlockedDay[]>("/api/blocked-dates") });
}

// Blocking a day keeps sessions already booked on it; say so, and point to where they can be moved or cancelled.
export function BookedWarning({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link
      to="/sessions"
      className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 ring-inset hover:bg-amber-100"
    >
      {count} {count === 1 ? "session still booked: blocking does not cancel it" : "sessions still booked: blocking does not cancel them"}
    </Link>
  );
}

// The "My hours" card: add a day off, see and remove the upcoming ones.
export function TimeOffCard({ timezone }: { timezone: string }) {
  const queryClient = useQueryClient();
  const list = useBlockedDates();
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  // Only a hint for the picker; the server refuses past days and days too far ahead with its own message.
  const [today] = useState(() => localDay(new Date(), timezone));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["blocked-dates"] });
  const add = useMutation({
    mutationFn: () => postJson<BlockedDay>("/api/blocked-dates", { day, reason: reason.trim() || undefined }),
    onSuccess: async () => {
      setDay("");
      setReason("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (d: string) => api<void>(`/api/blocked-dates/${d}`, { method: "DELETE" }),
    onSettled: refresh,
  });

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
        <CalendarIcon className="size-5 text-brand-700" />
        Time off
      </h2>
      <p className="mt-1 text-sm text-stone-600">Members can't book you on these days.</p>

      <form
        className="mt-5 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field id="time-off-day" label="Day off">
          <input
            id="time-off-day"
            type="date"
            required
            min={today}
            max={addDays(today, 365)}
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              add.reset();
            }}
            className={`${inputClass} min-w-0`}
          />
        </Field>
        <Field id="time-off-reason" label="Note (only you see this)">
          <input
            id="time-off-reason"
            type="text"
            maxLength={80}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          <PlusIcon className="size-4" />
          {add.isPending ? "Adding…" : "Add day off"}
        </Button>
      </form>
      {add.isError && (
        <div className="mt-3">
          <Callout>{add.error.message}</Callout>
        </div>
      )}

      <div className="mt-5 border-t border-stone-100 pt-4">
        {list.isPending && (
          <Loading className="space-y-2">
            <Bone className="h-12" />
            <Bone className="h-12" />
          </Loading>
        )}
        {list.isError && <Callout>Could not load your time off: {list.error.message}</Callout>}
        {list.data?.length === 0 && <p className="py-2 text-sm text-stone-500">No time off planned.</p>}
        {remove.isError && (
          <div className="mb-3">
            <Callout>{remove.error.message}</Callout>
          </div>
        )}
        <ul className="divide-y divide-stone-100">
          {list.data?.map((b, i) => {
            const p = dayParts(b.day);
            const removing = remove.isPending && remove.variables === b.day;
            return (
              <li key={b.day} style={stagger(i)} className="flex items-start gap-3 py-3 motion-safe:animate-rise">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-stone-900">{p.long}</p>
                  {b.reason && <p className="text-sm break-words text-stone-600">{b.reason}</p>}
                  <BookedWarning count={b.bookedSessions} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  className="w-11 shrink-0 px-0 text-stone-500 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => remove.mutate(b.day)}
                >
                  <CrossIcon className="size-4" />
                  <span className="sr-only">Remove time off on {p.dayMonth}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// The dashboard card: the next three days off, and the way to manage them.
export function TimeOffSummary() {
  const list = useBlockedDates();
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-stone-900">Time off</h2>
        <Link to="/availability" className="inline-flex min-h-11 items-center rounded-xl text-sm font-medium text-brand-700 hover:text-brand-800">
          Manage{" "}<span className="sr-only">time off</span>
        </Link>
      </div>
      {list.isPending && (
        <Loading className="mt-2 space-y-2">
          <Bone className="h-5" />
          <Bone className="h-5" />
        </Loading>
      )}
      {list.isError && <Callout>Could not load your time off: {list.error.message}</Callout>}
      {list.data?.length === 0 && <p className="mt-1 text-sm text-stone-500">No time off planned.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="mt-2 space-y-2 text-sm">
          {list.data.slice(0, 3).map((b) => (
            <li key={b.day} className="space-y-1">
              <p className="font-medium text-stone-700">{dayParts(b.day).long}</p>
              <BookedWarning count={b.bookedSessions} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
