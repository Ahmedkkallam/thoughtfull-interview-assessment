import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { Link, useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { dayParts, formatDay, formatRange, localDay } from "./format.ts";
import { Avatar, Badge, Bone, Button, buttonClass, Callout, CalendarIcon, ClockIcon, EmptyState, Loading, PageHeader, SearchIcon, stagger, Zone } from "./ui.tsx";

export type SessionItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "booked" | "cancelled";
  cancelReason: null | "member" | "professional" | "rescheduled";
  // Professionals only get the name; id and timezone are for members (reschedule is member-only).
  counterpart: { id?: string; name: string; timezone?: string };
};

type Scope = "upcoming" | "past";

const DAY_MS = 24 * 60 * 60 * 1000;

export function useSessions(scope: Scope) {
  return useQuery({ queryKey: ["sessions", scope], queryFn: () => api<SessionItem[]>(`/api/sessions?scope=${scope}`) });
}

function cancelledLabel(reason: SessionItem["cancelReason"], role: Me["role"]): string {
  if (reason === "rescheduled") return "Moved to a new time";
  if (reason === role) return "Cancelled by you";
  return `Cancelled by the ${reason === "member" ? "member" : "professional"}`;
}

// Consecutive sessions on the same local day (in the viewer's zone) share one date on the timeline.
export function groupByDay(sessions: SessionItem[], timezone: string) {
  const groups: { day: string; label: string; items: SessionItem[] }[] = [];
  for (const s of sessions) {
    const day = localDay(new Date(s.startsAt), timezone);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(s);
    else groups.push({ day, label: formatDay(new Date(s.startsAt), timezone), items: [s] });
  }
  return groups;
}

const tabs: { value: Scope; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
];

export function Sessions() {
  const me = useOutletContext<Me>();
  const [scope, setScope] = useState<Scope>("upcoming");

  // Arrow keys move between tabs, as screen-reader users expect from a tab list.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = scope === "upcoming" ? "past" : "upcoming";
    setScope(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <>
      <PageHeader
        title={me.role === "member" ? "My sessions" : "My schedule"}
        subtitle={<Zone prefix="Times shown in " zone={me.timezone} long />}
        action={
          me.role === "member" && (
            <Link to="/professionals" className={buttonClass()}>
              <SearchIcon className="size-4" />
              Book a session
            </Link>
          )
        }
      />
      <div role="tablist" aria-label="Sessions" className="mb-6 inline-flex rounded-2xl bg-stone-200/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            id={`tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={scope === t.value}
            aria-controls="sessions-panel"
            tabIndex={scope === t.value ? 0 : -1}
            onClick={() => setScope(t.value)}
            onKeyDown={onKey}
            className={`min-h-11 min-w-28 rounded-xl px-5 text-sm font-medium transition duration-150 ${
              scope === t.value ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="sessions-panel" role="tabpanel" aria-labelledby={`tab-${scope}`}>
        <Timeline key={scope} scope={scope} me={me} />
      </div>
    </>
  );
}

function Timeline({ scope, me }: { scope: Scope; me: Me }) {
  const sessions = useSessions(scope);

  if (sessions.isPending)
    return (
      <Loading className="space-y-6">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[5.5rem_1fr] sm:gap-6">
            <Bone className="h-10 w-28 sm:h-20 sm:w-20" />
            <Bone className="h-28" />
          </div>
        ))}
      </Loading>
    );
  if (sessions.isError) return <Callout>Could not load sessions: {sessions.error.message}</Callout>;
  if (sessions.data.length === 0)
    return scope === "upcoming" ? (
      <EmptyState
        icon={<CalendarIcon />}
        title="No upcoming sessions"
        action={
          me.role === "member" && (
            <Link to="/professionals" className={buttonClass()}>
              Find a professional
            </Link>
          )
        }
      >
        {me.role === "member" ? "When you book a session, it will show up here." : "Booked sessions will show up here."}
      </EmptyState>
    ) : (
      <EmptyState icon={<ClockIcon />} title="No past sessions">
        Sessions you've had will be listed here.
      </EmptyState>
    );

  return (
    <ol className="space-y-8">
      {groupByDay(sessions.data, me.timezone).map((g, gi) => {
        const p = dayParts(g.day);
        const muted = scope === "past";
        return (
          <li key={g.day} style={stagger(gi)} className="grid gap-3 motion-safe:animate-rise sm:grid-cols-[5.5rem_1fr] sm:gap-6">
            {/* Date rail: a row on phones, a calendar block that stays in view on wider screens. */}
            <div className="sm:sticky sm:top-6 sm:self-start">
              <h2 className="sr-only">{g.label}</h2>
              <div
                aria-hidden="true"
                className={`inline-flex items-baseline gap-1.5 rounded-xl px-3 py-1.5 sm:flex sm:w-20 sm:flex-col sm:items-center sm:gap-0 sm:py-3 ${
                  muted ? "bg-stone-100 text-stone-500" : "bg-brand-50 text-brand-800"
                }`}
              >
                <span className="text-xs font-semibold uppercase">{p.weekday}</span>
                <span className="text-lg font-semibold tabular-nums sm:text-2xl">{p.day}</span>
                <span className="text-xs">{p.month}</span>
              </div>
            </div>
            <ul className="space-y-3 sm:border-l sm:border-stone-200 sm:pl-6">
              {g.items.map((s) => (
                <Row key={s.id} s={s} me={me} actions={scope === "upcoming"} muted={muted} />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ s, me, actions, muted }: { s: SessionItem; me: Me; actions: boolean; muted: boolean }) {
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
  const cancelled = s.status === "cancelled";
  const quiet = muted || cancelled;

  return (
    <li
      className={`rounded-card border p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-5 ${
        quiet ? "border-stone-200 bg-stone-50/70" : "border-stone-200/80 bg-white"
      }`}
    >
      <div className="flex items-start gap-4">
        <Avatar name={s.counterpart.name} />
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-semibold tabular-nums ${cancelled ? "text-stone-500 line-through decoration-stone-300" : quiet ? "text-stone-600" : "text-stone-900"}`}>
            {formatRange(start, end, me.timezone)}
          </p>
          <p className={`text-sm ${quiet ? "text-stone-500" : "text-stone-600"}`}>with {s.counterpart.name}</p>
        </div>
        {cancelled ? (
          <Badge tone={s.cancelReason === "rescheduled" ? "muted" : "rose"}>{cancelledLabel(s.cancelReason, me.role)}</Badge>
        ) : (
          <Badge tone={muted ? "muted" : "brand"}>{muted ? "Ended" : "Booked"}</Badge>
        )}
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
              <Button variant="ghost" size="sm" className="text-stone-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirming(true)} disabled={tooLate}>
                Cancel
              </Button>
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
