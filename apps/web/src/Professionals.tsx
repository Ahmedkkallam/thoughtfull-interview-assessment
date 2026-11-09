import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupSlotsByLocalDay } from "@thoughtfull/domain";
import type { ReactNode } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatRange, formatTime, formatZoneName } from "./format.ts";
import { useSessions } from "./Sessions.tsx";
import { ArrowLeftIcon, Avatar, Button, buttonClass, Callout, Card, CheckIcon, PageHeader, Skeleton } from "./ui.tsx";

type Professional = { id: string; name: string; timezone: string };
type Booked = { id: string; startsAt: string; endsAt: string; status: string; professional: Professional };

const SESSION_MINUTES = 50;

// The API refuses professionals too; this just avoids showing them pages that cannot work.
function MemberOnly({ children }: { children: (me: Me) => ReactNode }) {
  const me = useOutletContext<Me>();
  if (me.role !== "member") return <Card className="text-stone-700">This page is for members.</Card>;
  return <>{children(me)}</>;
}

const backLink = "inline-flex min-h-11 items-center gap-1.5 rounded-xl text-sm font-medium text-stone-600 hover:text-brand-700";

export function ProfessionalList() {
  return <MemberOnly>{() => <List />}</MemberOnly>;
}

function List() {
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/api/professionals") });
  return (
    <>
      <PageHeader title="Find a professional" subtitle="Choose someone to see their free times." />
      {pros.isPending && <Skeleton rows={3} />}
      {pros.isError && <Callout>Could not load professionals: {pros.error.message}</Callout>}
      {pros.data?.length === 0 && <Card className="text-stone-600">No professionals yet.</Card>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {pros.data?.map((p) => (
          // The name link stretches over the card: the whole card is clickable, and the link's name stays just the name.
          <li
            key={p.id}
            className="relative flex items-center gap-4 rounded-card border border-stone-200/80 bg-white p-5 shadow-sm transition duration-200 hover:border-brand-200 hover:shadow-md motion-safe:hover:-translate-y-0.5"
          >
            <Avatar name={p.name} />
            <div className="min-w-0">
              <Link to={`/professionals/${p.id}`} className="font-semibold text-stone-900 after:absolute after:inset-0 after:rounded-card">
                {p.name}
              </Link>
              <p className="text-sm text-stone-600">Works in {p.timezone}</p>
            </div>
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

  if (pro.isPending || slots.isPending) return <Skeleton rows={4} />;
  if (pro.isError) return <Callout>Could not load this professional: {pro.error.message}</Callout>;
  if (slots.isError) return <Callout>Could not load free times: {slots.error.message}</Callout>;

  const days = groupSlotsByLocalDay(
    slots.data.slots.map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), iso: s.startsAt })),
    timezone,
  );
  return (
    <div className="space-y-6">
      <Link to="/professionals" className={backLink}>
        <ArrowLeftIcon className="size-4" />
        All professionals
      </Link>
      <Card className="flex items-center gap-4">
        <Avatar name={pro.data.name} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{pro.data.name}</h1>
          <p className="text-sm text-stone-600">Times shown in {timezone}</p>
        </div>
      </Card>
      {target.old && (
        <Callout tone="info" role="status">
          Choose a new time for your session on {formatDay(new Date(target.old.startsAt), timezone)},{" "}
          {formatTime(new Date(target.old.startsAt), timezone)}
        </Callout>
      )}
      {days.length === 0 && (
        <Card className="text-center">
          <p className="font-medium text-stone-800">No free times in the next 4 weeks</p>
          <p className="mt-1 text-sm text-stone-600">Please check back later, or choose another professional.</p>
        </Card>
      )}
      {days.map((d) => (
        <section key={d.day} aria-labelledby={`day-${d.day}`} className="space-y-3">
          <h2 id={`day-${d.day}`} className="text-sm font-semibold text-stone-700">
            {formatDay(d.slots[0]!.startsAt, timezone)}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.slots.map((s) => {
              const label = formatRange(s.startsAt, s.endsAt, timezone);
              // Clocks going back repeat an hour; name the zone on repeated labels so the two stay distinguishable.
              const repeated = d.slots.filter((o) => formatRange(o.startsAt, o.endsAt, timezone) === label).length > 1;
              return (
                <li key={s.iso}>
                  <Link
                    to={`/professionals/${id}/confirm?start=${encodeURIComponent(s.iso)}${target.sessionId ? `&reschedule=${target.sessionId}` : ""}`}
                    className="flex min-h-11 items-center justify-center rounded-xl border border-brand-200 bg-white px-3 text-sm font-medium text-brand-800 tabular-nums shadow-xs transition duration-150 hover:border-brand-500 hover:bg-brand-50 hover:shadow-sm active:scale-[0.98] motion-safe:hover:-translate-y-0.5"
                  >
                    {repeated ? `${label} ${formatZoneName(s.startsAt, timezone)}` : label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
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

  const back = (
    <Link to={`/professionals/${id}`} className="font-medium underline underline-offset-4">
      Back to the calendar
    </Link>
  );
  if (Number.isNaN(start.getTime())) return <Callout>That time is not valid. {back}</Callout>;
  if (pro.isPending || target.loading) return <Skeleton rows={2} />;
  if (pro.isError) return <Callout>Could not load this professional: {pro.error.message}</Callout>;

  if (book.isSuccess) {
    const s = book.data;
    return (
      <Card className="mx-auto max-w-lg text-center motion-safe:animate-rise">
        <span className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 motion-safe:animate-pop">
          <CheckIcon className="size-7" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900">{moving ? "Moved" : "Booked"}</h1>
        <p role="status" className="mt-2 text-stone-600">
          {moving ? "Moved. Your reminders were updated." : "Booked. You'll get reminders 24 hours and 1 hour before."}
        </p>
        <p className="mt-4 rounded-xl bg-sand-100 px-4 py-3 text-stone-800">
          {s.professional.name}, {formatDay(new Date(s.startsAt), timezone)},{" "}
          {formatRange(new Date(s.startsAt), new Date(s.endsAt), timezone)} ({timezone})
        </p>
        <Link to="/sessions" className={`${buttonClass()} mt-6`}>
          My sessions
        </Link>
      </Card>
    );
  }

  const end = new Date(start.getTime() + SESSION_MINUTES * 60_000);
  const row = "flex flex-col gap-0.5 py-3 sm:flex-row sm:justify-between sm:gap-4";
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title={moving ? "Move your session" : "Confirm your session"} subtitle="Please check the details before you continue." />
      {target.old && (
        <Callout tone="info">
          Currently {formatDay(new Date(target.old.startsAt), timezone)},{" "}
          {formatRange(new Date(target.old.startsAt), new Date(target.old.endsAt), timezone)} ({timezone})
        </Callout>
      )}
      <Card>
        <dl className="divide-y divide-stone-100">
          <div className={row}>
            <dt className="text-sm text-stone-600">Professional</dt>
            <dd className="font-medium text-stone-900">{pro.data.name}</dd>
          </div>
          <div className={row}>
            <dt className="text-sm text-stone-600">Date</dt>
            <dd className="font-medium text-stone-900">{formatDay(start, timezone)}</dd>
          </div>
          <div className={row}>
            <dt className="text-sm text-stone-600">Time</dt>
            <dd className="font-medium text-stone-900 tabular-nums">
              {formatRange(start, end, timezone)} ({timezone})
            </dd>
          </div>
          <div className={row}>
            <dt className="text-sm text-stone-600">Length</dt>
            <dd className="font-medium text-stone-900">{SESSION_MINUTES} minutes</dd>
          </div>
        </dl>
      </Card>
      {book.isError && (
        <Callout>
          {book.error.message} {back}
        </Callout>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link className={buttonClass("secondary")} to={`/professionals/${id}`}>
          Back
        </Link>
        <Button onClick={() => book.mutate()} disabled={book.isPending}>
          {book.isPending ? (moving ? "Moving…" : "Booking…") : moving ? "Move session" : "Book session"}
        </Button>
      </div>
    </div>
  );
}
