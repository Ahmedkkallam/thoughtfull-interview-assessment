import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupSlotsByLocalDay } from "@thoughtfull/domain";
import { useState, type ReactNode } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { BookingSummary } from "./BookingSummary.tsx";
import { shownDayOf, SlotCalendar } from "./Calendar.tsx";
import { formatDay, formatRange, formatTime, zoneLabel, zoneTitle } from "./format.ts";
import { useSessions } from "./Sessions.tsx";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Avatar,
  Bone,
  Button,
  buttonClass,
  Callout,
  CalendarIcon,
  Card,
  CheckIcon,
  ClockIcon,
  EmptyState,
  Loading,
  PageHeader,
  SearchIcon,
  stagger,
  Zone,
} from "./ui.tsx";

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

// A neutral line under the name; the API has no title field, so only a name that says "counsellor" gets that word.
const roleLine = (name: string) => (/counsel/i.test(name) ? "Counsellor" : "Professional");

export function ProfessionalList() {
  return <MemberOnly>{() => <List />}</MemberOnly>;
}

function List() {
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/api/professionals") });
  return (
    <>
      <PageHeader title="Find a professional" subtitle="Choose someone to see their free times." />
      {pros.isPending && (
        <Loading className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-card border border-stone-200/80 bg-white p-6">
              <Bone className="size-16 rounded-full" />
              <Bone className="h-5 w-2/3" />
              <Bone className="h-4 w-1/2" />
              <Bone className="mt-4 h-11" />
            </div>
          ))}
        </Loading>
      )}
      {pros.isError && <Callout>Could not load professionals: {pros.error.message}</Callout>}
      {pros.data?.length === 0 && (
        <EmptyState icon={<SearchIcon />} title="No professionals yet">
          Please check back soon.
        </EmptyState>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pros.data?.map((p, i) => (
          // The name link stretches over the card: the whole card is clickable, and the link's name stays just the name.
          <li
            key={p.id}
            style={stagger(i)}
            className="group relative flex flex-col rounded-card border border-stone-200/80 bg-white p-6 shadow-sm transition duration-200 focus-within:border-brand-300 hover:border-brand-200 hover:shadow-md motion-safe:animate-rise motion-safe:hover:-translate-y-0.5"
          >
            <Avatar name={p.name} size="xl" />
            <Link to={`/professionals/${p.id}`} className="mt-4 text-lg font-semibold text-stone-900 after:absolute after:inset-0 after:rounded-card">
              {p.name}
            </Link>
            <p className="text-sm font-medium text-brand-700">{roleLine(p.name)}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-stone-600">
              <ClockIcon className="size-4 text-stone-400" />
              <Zone prefix="Works on " zone={p.timezone} />
            </p>
            {/* Looks like a button; the stretched name link above is what you actually click. */}
            <span aria-hidden="true" className={`${buttonClass("secondary")} mt-6 w-full group-hover:border-brand-300 group-hover:bg-brand-50`}>
              See availability
              <ArrowRightIcon className="size-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
            </span>
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

function ProfileLoading() {
  return (
    <Loading className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <Bone className="h-24" />
        <Bone className="h-72" />
      </div>
      <Bone className="hidden h-80 lg:block" />
    </Loading>
  );
}

function Profile({ timezone }: { timezone: string }) {
  const id = useParams().id!;
  const target = useRescheduleTarget();
  const pro = useProfessional(id);
  const [selected, setSelected] = useState<string | null>(null);
  const askedDay = useSearchParams()[0].get("day");
  const slots = useQuery({
    queryKey: ["slots", id],
    queryFn: () => api<{ slots: { startsAt: string; endsAt: string }[] }>(`/api/professionals/${id}/slots`),
  });

  if (pro.isPending || slots.isPending) return <ProfileLoading />;
  if (pro.isError) return <Callout>Could not load this professional: {pro.error.message}</Callout>;
  if (slots.isError) return <Callout>Could not load free times: {slots.error.message}</Callout>;

  const days = groupSlotsByLocalDay(
    slots.data.slots.map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), iso: s.startsAt })),
    timezone,
  );
  const shownDay = days.length > 0 ? shownDayOf(days, askedDay) : null;
  const slotHref = (iso: string) =>
    `/professionals/${id}/confirm?start=${encodeURIComponent(iso)}${target.sessionId ? `&reschedule=${target.sessionId}` : ""}`;
  // A time counts only on the day being shown: switching days asks for a time again (coming back restores it).
  // A refetch that drops the time simply clears the choice.
  const slot = days.find((d) => d.day === shownDay)?.slots.find((s) => s.iso === selected) ?? null;

  return (
    // Extra room at the bottom on phones once the summary bar shows.
    <div className={`space-y-6 ${slot ? "pb-20 lg:pb-0" : ""}`}>
      <Link to="/professionals" className={backLink}>
        <ArrowLeftIcon className="size-4" />
        All professionals
      </Link>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:gap-8">
        <div className="min-w-0 space-y-6">
          <Card className="flex items-center gap-4">
            <Avatar name={pro.data.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{pro.data.name}</h1>
              <p className="text-sm text-stone-600">
                {roleLine(pro.data.name)} · <Zone prefix="Works on " zone={pro.data.timezone} />
              </p>
              <p className="text-sm text-stone-600">
                <Zone prefix="Times shown in " zone={timezone} long />
              </p>
            </div>
          </Card>
          {target.old && (
            <Callout tone="info" role="status">
              Choose a new time for your session on {formatDay(new Date(target.old.startsAt), timezone)},{" "}
              {formatTime(new Date(target.old.startsAt), timezone)}
            </Callout>
          )}
          {!shownDay ? (
            <EmptyState
              icon={<CalendarIcon />}
              title="No free times in the next 4 weeks"
              action={
                <Link to="/professionals" className={buttonClass("secondary")}>
                  Choose another professional
                </Link>
              }
            >
              Please check back later.
            </EmptyState>
          ) : (
            <SlotCalendar days={days} shownDay={shownDay} timezone={timezone} selected={selected} onSelect={setSelected} />
          )}
        </div>
        {shownDay && (
          <BookingSummary professional={pro.data.name} day={shownDay} slot={slot} timezone={timezone} href={slot && slotHref(slot.iso)} moving={!!target.sessionId} />
        )}
      </div>
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
  if (pro.isPending || target.loading)
    return (
      <Loading className="mx-auto max-w-lg space-y-4">
        <Bone className="h-10 w-2/3" />
        <Bone className="h-72" />
      </Loading>
    );
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
        <p title={zoneTitle(timezone)} className="mt-4 rounded-xl bg-sand-100 px-4 py-3 text-stone-800">
          {s.professional.name}, {formatDay(new Date(s.startsAt), timezone)},{" "}
          {formatRange(new Date(s.startsAt), new Date(s.endsAt), timezone)} ({zoneLabel(timezone)})
        </p>
        <Link to="/sessions" className={`${buttonClass()} mt-6`}>
          My sessions
        </Link>
      </Card>
    );
  }

  const end = new Date(start.getTime() + SESSION_MINUTES * 60_000);
  const row = "flex items-start gap-3 px-6 py-4";
  return (
    <div className="mx-auto max-w-lg">
      <Link to={`/professionals/${id}`} className={`${backLink} mb-4`}>
        <ArrowLeftIcon className="size-4" />
        Back
      </Link>
      <PageHeader title={moving ? "Move your session" : "Confirm your session"} subtitle="Please check the details before you continue." />
      <div className="space-y-5">
        {target.old && (
          <Callout tone="info">
            Currently {formatDay(new Date(target.old.startsAt), timezone)},{" "}
            {formatRange(new Date(target.old.startsAt), new Date(target.old.endsAt), timezone)} ({zoneLabel(timezone)})
          </Callout>
        )}
        <div className="overflow-hidden rounded-card border border-stone-200/80 bg-white shadow-sm">
          <div className="flex items-center gap-4 bg-linear-to-br from-brand-50 to-sand-100 px-6 py-5">
            <Avatar name={pro.data.name} size="lg" />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-stone-900">{pro.data.name}</p>
              <p className="text-sm text-stone-600">
                <Zone prefix="Works on " zone={pro.data.timezone} />
              </p>
            </div>
          </div>
          <dl className="divide-y divide-stone-100">
            <div className={row}>
              <CalendarIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
              <div>
                <dt className="text-xs text-stone-500">Date</dt>
                <dd className="font-medium text-stone-900">{formatDay(start, timezone)}</dd>
              </div>
            </div>
            <div className={row}>
              <ClockIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
              <div>
                <dt className="text-xs text-stone-500">Time</dt>
                <dd title={zoneTitle(timezone)} className="font-medium text-stone-900 tabular-nums">
                  {formatRange(start, end, timezone)} ({zoneLabel(timezone)})
                </dd>
              </div>
            </div>
            <div className={row}>
              <span aria-hidden="true" className="size-5 shrink-0" />
              <div>
                <dt className="text-xs text-stone-500">Length</dt>
                <dd className="font-medium text-stone-900">{SESSION_MINUTES} minutes</dd>
              </div>
            </div>
          </dl>
          <p className="border-t border-stone-100 bg-sand-50 px-6 py-3 text-sm text-stone-600">
            {moving ? "Your reminders move with the session." : "You'll get reminders 24 hours and 1 hour before."}
          </p>
        </div>
        {book.isError && (
          <Callout>
            {book.error.message} {back}
          </Callout>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link className={buttonClass("secondary")} to={`/professionals/${id}`}>
            Choose another time
          </Link>
          <Button onClick={() => book.mutate()} disabled={book.isPending}>
            {book.isPending ? (moving ? "Moving…" : "Booking…") : moving ? "Move session" : "Book session"}
          </Button>
        </div>
      </div>
    </div>
  );
}
