import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupSlotsByLocalDay } from "@thoughtfull/domain";
import type { ReactNode } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatRange, formatTime } from "./format.ts";
import { useSessions } from "./Sessions.tsx";

type Professional = { id: string; name: string; timezone: string };
type Booked = { id: string; startsAt: string; endsAt: string; status: string; professional: Professional };

const SESSION_MINUTES = 50;

// The API refuses professionals too; this just avoids showing them pages that cannot work.
function MemberOnly({ children }: { children: (me: Me) => ReactNode }) {
  const me = useOutletContext<Me>();
  if (me.role !== "member") return <p>This page is for members.</p>;
  return <>{children(me)}</>;
}

export function ProfessionalList() {
  return <MemberOnly>{() => <List />}</MemberOnly>;
}

function List() {
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/api/professionals") });
  return (
    <>
      <h1>Find a professional</h1>
      {pros.isPending && <p role="status">Loading…</p>}
      {pros.isError && <p role="alert">Could not load professionals: {pros.error.message}</p>}
      {pros.data?.length === 0 && <p>No professionals yet.</p>}
      <ul className="plain">
        {pros.data?.map((p) => (
          <li key={p.id}>
            <Link to={`/professionals/${p.id}`}>{p.name}</Link> (works in {p.timezone})
          </li>
        ))}
      </ul>
    </>
  );
}

function useProfessional(id: string) {
  return useQuery({ queryKey: ["professional", id], queryFn: () => api<Professional>(`/api/professionals/${id}`) });
}

export function ProfessionalProfile() {
  return <MemberOnly>{(me) => <Profile timezone={me.timezone} />}</MemberOnly>;
}

// When moving a session, the old one is looked up so the page can say which time is being replaced.
function useRescheduleTarget() {
  const sessionId = useSearchParams()[0].get("reschedule");
  const upcoming = useSessions("upcoming");
  const old = sessionId ? upcoming.data?.find((s) => s.id === sessionId) : undefined;
  return { sessionId, old, loading: !!sessionId && upcoming.isPending };
}

function Profile({ timezone }: { timezone: string }) {
  const id = useParams().id!;
  const target = useRescheduleTarget();
  const pro = useProfessional(id);
  const slots = useQuery({
    queryKey: ["slots", id],
    queryFn: () => api<{ slots: { startsAt: string; endsAt: string }[] }>(`/api/professionals/${id}/slots`),
  });

  if (pro.isPending || slots.isPending) return <p role="status">Loading…</p>;
  if (pro.isError) return <p role="alert">Could not load this professional: {pro.error.message}</p>;
  if (slots.isError) return <p role="alert">Could not load free times: {slots.error.message}</p>;

  const days = groupSlotsByLocalDay(
    slots.data.slots.map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), iso: s.startsAt })),
    timezone,
  );
  return (
    <>
      <p>
        <Link to="/professionals">All professionals</Link>
      </p>
      <h1>{pro.data.name}</h1>
      <p>Times shown in {timezone}</p>
      {target.old && (
        <p role="status">
          Choose a new time for your session on {formatDay(new Date(target.old.startsAt), timezone)},{" "}
          {formatTime(new Date(target.old.startsAt), timezone)}
        </p>
      )}
      {days.length === 0 && <p>No free times in the next 4 weeks</p>}
      {days.map((d) => (
        <section key={d.day} aria-labelledby={`day-${d.day}`}>
          <h2 id={`day-${d.day}`}>{formatDay(d.slots[0]!.startsAt, timezone)}</h2>
          <ul className="plain slots">
            {d.slots.map((s) => (
              <li key={s.iso}>
                <Link className="slot" to={`/professionals/${id}/confirm?start=${encodeURIComponent(s.iso)}${target.sessionId ? `&reschedule=${target.sessionId}` : ""}`}>
                  {formatRange(s.startsAt, s.endsAt, timezone)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function BookingConfirm() {
  return <MemberOnly>{(me) => <Confirm timezone={me.timezone} />}</MemberOnly>;
}

function Confirm({ timezone }: { timezone: string }) {
  const id = useParams().id!;
  const startParam = useSearchParams()[0].get("start") ?? "";
  const start = new Date(startParam);
  const pro = useProfessional(id);
  const target = useRescheduleTarget();
  const moving = !!target.sessionId;
  const queryClient = useQueryClient();

  const book = useMutation({
    mutationFn: () =>
      moving
        ? postJson<Booked>(`/api/sessions/${target.sessionId}/reschedule`, { startsAt: startParam })
        : postJson<Booked>("/api/sessions", { professionalId: id, startsAt: startParam }),
    // Whatever the outcome, the slot list and the session lists are stale now.
    onSettled: () => {
      for (const key of ["slots", "sessions", "notifications"]) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const back = <Link to={`/professionals/${id}`}>Back to the calendar</Link>;
  if (Number.isNaN(start.getTime())) return <p role="alert">That time is not valid. {back}</p>;
  if (pro.isPending || target.loading) return <p role="status">Loading…</p>;
  if (pro.isError) return <p role="alert">Could not load this professional: {pro.error.message}</p>;

  if (book.isSuccess) {
    const s = book.data;
    return (
      <>
        <h1>{moving ? "Moved" : "Booked"}</h1>
        <p role="status">
          {moving ? "Moved. Your reminders were updated." : "Booked. You'll get reminders 24 hours and 1 hour before."}
        </p>
        <p>
          {s.professional.name}, {formatDay(new Date(s.startsAt), timezone)},{" "}
          {formatRange(new Date(s.startsAt), new Date(s.endsAt), timezone)} ({timezone})
        </p>
        <p>
          <Link to="/sessions">My sessions</Link>
        </p>
      </>
    );
  }

  const end = new Date(start.getTime() + SESSION_MINUTES * 60_000);
  return (
    <>
      <h1>{moving ? "Move your session" : "Confirm your session"}</h1>
      {target.old && (
        <p>
          Currently {formatDay(new Date(target.old.startsAt), timezone)},{" "}
          {formatRange(new Date(target.old.startsAt), new Date(target.old.endsAt), timezone)} ({timezone})
        </p>
      )}
      <dl>
        <dt>Professional</dt>
        <dd>{pro.data.name}</dd>
        <dt>Date</dt>
        <dd>{formatDay(start, timezone)}</dd>
        <dt>Time</dt>
        <dd>
          {formatRange(start, end, timezone)} ({timezone})
        </dd>
        <dt>Length</dt>
        <dd>{SESSION_MINUTES} minutes</dd>
      </dl>
      {book.isError && (
        <p role="alert" className="error">
          {book.error.message} {back}
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={() => book.mutate()} disabled={book.isPending}>
          {book.isPending ? (moving ? "Moving…" : "Booking…") : moving ? "Move session" : "Book session"}
        </button>
        <Link className="button-link" to={`/professionals/${id}`}>
          Back
        </Link>
      </div>
    </>
  );
}
