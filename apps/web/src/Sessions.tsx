import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatRange } from "./format.ts";
import { Badge, Button, buttonClass, Callout, Card, PageHeader, Skeleton, Zone } from "./ui.tsx";

export type SessionItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "booked" | "cancelled";
  cancelReason: null | "member" | "professional" | "rescheduled";
  // Professionals only get the name; id and timezone are for members (reschedule is member-only).
  counterpart: { id?: string; name: string; timezone?: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function useSessions(scope: "upcoming" | "past") {
  return useQuery({ queryKey: ["sessions", scope], queryFn: () => api<SessionItem[]>(`/api/sessions?scope=${scope}`) });
}

function cancelledLabel(reason: SessionItem["cancelReason"], role: Me["role"]): string {
  if (reason === "rescheduled") return "Moved to a new time";
  if (reason === role) return "Cancelled by you";
  return `Cancelled by the ${reason === "member" ? "member" : "professional"}`;
}

export function Sessions() {
  const me = useOutletContext<Me>();
  return (
    <>
      <PageHeader title={me.role === "member" ? "My sessions" : "My schedule"} subtitle={<Zone prefix="Times shown in " zone={me.timezone} long />} />
      <div className="space-y-10">
        <Section scope="upcoming" title="Upcoming" me={me} />
        <Section scope="past" title="Past" me={me} />
      </div>
    </>
  );
}

function Section({ scope, title, me }: { scope: "upcoming" | "past"; title: string; me: Me }) {
  const sessions = useSessions(scope);
  return (
    <section aria-labelledby={`sessions-${scope}`} className="space-y-3">
      <h2 id={`sessions-${scope}`} className="text-lg font-semibold text-stone-900">
        {title}
      </h2>
      {sessions.isPending && <Skeleton rows={2} />}
      {sessions.isError && <Callout>Could not load sessions: {sessions.error.message}</Callout>}
      {sessions.data?.length === 0 && <Card className="text-sm text-stone-600">No {scope} sessions.</Card>}
      <ul className="space-y-3">
        {sessions.data?.map((s) => (
          <Row key={s.id} s={s} me={me} actions={scope === "upcoming"} />
        ))}
      </ul>
    </section>
  );
}

function Row({ s, me, actions }: { s: SessionItem; me: Me; actions: boolean }) {
  const [confirming, setConfirming] = useState(false);
  // Read once per row render lifetime; only a hint so the buttons look right, the server decides.
  const [openedAt] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => postJson<SessionItem>(`/api/sessions/${s.id}/cancel`, {}),
    onSuccess: () => setConfirming(false),
    // Success or refusal, the lists and slots may have changed.
    onSettled: () => {
      for (const key of ["sessions", "slots", "notifications"]) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const start = new Date(s.startsAt);
  const end = new Date(s.endsAt);
  const active = actions && s.status === "booked";
  const tooLate = me.role === "member" && start.getTime() - openedAt < DAY_MS;
  const day = formatDay(start, me.timezone);
  // "Thu 12 Nov 2026" -> the calendar-style block on the left; the full date is still written out for everyone.
  const [weekday, dayOfMonth, month] = day.split(" ");
  const cancelled = s.status === "cancelled";

  return (
    <li
      className={`rounded-card border bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-5 ${cancelled ? "border-stone-200 bg-stone-50/60" : "border-stone-200/80"}`}
    >
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className={`flex w-14 shrink-0 flex-col items-center rounded-xl py-2 leading-tight ${cancelled ? "bg-stone-100 text-stone-500" : "bg-brand-50 text-brand-800"}`}
        >
          <span className="text-xs font-medium uppercase">{weekday}</span>
          <span className="text-xl font-semibold">{dayOfMonth}</span>
          <span className="text-xs">{month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-medium ${cancelled ? "text-stone-500" : "text-stone-900"}`}>{day}</p>
            {cancelled ? (
              <Badge tone={s.cancelReason === "rescheduled" ? "muted" : "rose"}>{cancelledLabel(s.cancelReason, me.role)}</Badge>
            ) : (
              <Badge tone="brand">Booked</Badge>
            )}
          </div>
          <p className={`mt-0.5 tabular-nums ${cancelled ? "text-stone-500 line-through decoration-stone-300" : "text-stone-700"}`}>
            {formatRange(start, end, me.timezone)} with {s.counterpart.name}
          </p>
        </div>
      </div>

      {cancel.isSuccess && (
        <p role="status" className="mt-3 text-sm font-medium text-brand-700 motion-safe:animate-fade">
          Session cancelled.
        </p>
      )}
      {active && !cancel.isSuccess && (
        <div className="mt-4 border-t border-stone-100 pt-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 motion-safe:animate-fade">
              <span className="mr-auto text-sm font-medium text-amber-900">Cancel this session?</span>
              <Button variant="danger" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Yes
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                No
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)} disabled={tooLate}>
                Cancel
              </Button>
              {me.role === "member" &&
                s.counterpart.id &&
                (tooLate ? (
                  <Button variant="secondary" size="sm" disabled>
                    Reschedule
                  </Button>
                ) : (
                  <Link className={buttonClass("secondary", "sm")} to={`/professionals/${s.counterpart.id}?reschedule=${s.id}`}>
                    Reschedule
                  </Link>
                ))}
              {tooLate && <span className="text-xs text-stone-500">Changes are possible up to 24 hours before the start.</span>}
            </div>
          )}
        </div>
      )}
      {cancel.isError && (
        <div className="mt-3">
          <Callout>{cancel.error.message}</Callout>
        </div>
      )}
    </li>
  );
}
