import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatRange } from "./format.ts";

export type SessionItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "booked" | "cancelled";
  cancelReason: null | "member" | "professional" | "rescheduled";
  counterpart: { id: string; name: string; timezone: string };
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
      <h1>{me.role === "member" ? "My sessions" : "My schedule"}</h1>
      <p>Times shown in {me.timezone}</p>
      <Section scope="upcoming" title="Upcoming" me={me} />
      <Section scope="past" title="Past" me={me} />
    </>
  );
}

function Section({ scope, title, me }: { scope: "upcoming" | "past"; title: string; me: Me }) {
  const sessions = useSessions(scope);
  return (
    <section aria-labelledby={`sessions-${scope}`}>
      <h2 id={`sessions-${scope}`}>{title}</h2>
      {sessions.isPending && <p role="status">Loading…</p>}
      {sessions.isError && <p role="alert">Could not load sessions: {sessions.error.message}</p>}
      {sessions.data?.length === 0 && <p>No {scope} sessions.</p>}
      <ul className="plain">
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

  return (
    <li className="session">
      <strong>{formatDay(start, me.timezone)}</strong>, {formatRange(start, end, me.timezone)} with {s.counterpart.name}
      {s.status === "cancelled" && <span className="badge"> {cancelledLabel(s.cancelReason, me.role)}</span>}
      {cancel.isSuccess && <p role="status">Session cancelled.</p>}
      {active && !cancel.isSuccess && (
        <div className="actions">
          {confirming ? (
            <>
              <span>Cancel this session?</span>
              <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Yes
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                No
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setConfirming(true)} disabled={tooLate}>
                Cancel
              </button>
              {me.role === "member" &&
                (tooLate ? (
                  <button type="button" disabled>
                    Reschedule
                  </button>
                ) : (
                  <Link className="button-link" to={`/professionals/${s.counterpart.id}?reschedule=${s.id}`}>
                    Reschedule
                  </Link>
                ))}
              {tooLate && <span>Changes are possible up to 24 hours before the start.</span>}
            </>
          )}
        </div>
      )}
      {cancel.isError && (
        <p role="alert" className="error">
          {cancel.error.message}
        </p>
      )}
    </li>
  );
}
