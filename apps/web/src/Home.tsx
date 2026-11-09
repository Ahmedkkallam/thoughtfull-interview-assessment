import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";
import { daySummary, weekdays, type Hours } from "./Availability.tsx";
import { addDays, formatDay, formatRange, localDay, relativeTime, zoneLabel, zoneTitle } from "./format.ts";
import { NotificationIcon, sentence, useNotifications } from "./Notifications.tsx";
import { groupByDay, useSessions, type SessionItem } from "./Sessions.tsx";
import {
  ArrowRightIcon,
  Avatar,
  BellIcon,
  Bone,
  buttonClass,
  Callout,
  CalendarIcon,
  Card,
  ClockIcon,
  EmptyState,
  InboxIcon,
  LeafIcon,
  Loading,
  PageHeader,
  SearchIcon,
  stagger,
} from "./ui.tsx";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Booked sessions only, soonest first (cancelled ones stay on the sessions page).
const booked = (list: SessionItem[] | undefined) =>
  (list ?? []).filter((s) => s.status === "booked").sort((a, b) => a.startsAt.localeCompare(b.startsAt));

export function Home() {
  const me = useOutletContext<Me>();
  return me.role === "member" ? <MemberHome me={me} /> : <ProfessionalHome me={me} />;
}

function MemberHome({ me }: { me: Me }) {
  const upcoming = useSessions("upcoming");
  const past = useSessions("past");
  const notes = useNotifications();
  const next = booked(upcoming.data)[0];

  return (
    <>
      <PageHeader
        title={<>Welcome, {me.name}</>}
        subtitle="Here's what's coming up."
        action={
          <Link to="/professionals" className={buttonClass()}>
            <SearchIcon className="size-4" />
            Book a session
          </Link>
        }
      />
      <div className="space-y-6">
        {upcoming.isPending ? (
          <Loading>
            <Bone className="h-52 rounded-card" />
          </Loading>
        ) : upcoming.isError ? (
          <Callout>Could not load your sessions: {upcoming.error.message}</Callout>
        ) : next ? (
          <NextSession s={next} timezone={me.timezone} />
        ) : (
          <EmptyState
            icon={<LeafIcon />}
            title="No sessions booked yet"
            action={
              <Link to="/professionals" className={buttonClass()}>
                Find a professional
              </Link>
            }
          >
            Pick a professional and a time that suits you. You'll see it here.
          </EmptyState>
        )}

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat to="/sessions" label="Upcoming" value={upcoming.data && booked(upcoming.data).length} icon={<CalendarIcon />} />
          <Stat to="/sessions" label="Past" value={past.data?.length} icon={<ClockIcon />} />
          <Stat to="/notifications" label="Unread" value={notes.data?.filter((n) => !n.readAt).length} icon={<BellIcon />} />
        </div>

        <RecentNotifications me={me} />
      </div>
    </>
  );
}

// The hero: who, when (in the member's zone, with a relative hint), and the way to change it.
function NextSession({ s, timezone }: { s: SessionItem; timezone: string }) {
  // Read once; only for the "in 2 days" hint, the exact time is always written next to it.
  const [now] = useState(() => new Date());
  const start = new Date(s.startsAt);
  return (
    <section
      aria-labelledby="next-session"
      className="relative overflow-hidden rounded-card bg-linear-to-br from-brand-700 to-brand-900 p-6 text-white shadow-md sm:p-8"
    >
      <div aria-hidden="true" className="absolute -top-20 -right-20 size-64 rounded-full bg-brand-400/20 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="next-session" className="text-sm font-medium text-brand-100">
            Your next session
          </h2>
          <p className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{formatDay(start, timezone)}</p>
          <p title={zoneTitle(timezone)} className="mt-1 text-lg text-brand-50 tabular-nums">
            {formatRange(start, new Date(s.endsAt), timezone)} ({zoneLabel(timezone)})
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 ring-1 ring-white/20">
              <Avatar name={s.counterpart.name} size="sm" />
              <span className="text-sm">with {s.counterpart.name}</span>
            </span>
            <span className="rounded-full bg-amber-200/90 px-3 py-1 text-sm font-medium text-amber-950">{relativeTime(start, now)}</span>
          </div>
        </div>
        <Link to="/sessions" className={`${buttonClass("secondary")} border-transparent`}>
          Reschedule or cancel
        </Link>
      </div>
    </section>
  );
}

function Stat({ to, label, value, icon }: { to: string; label: string; value: number | undefined; icon: ReactNode }) {
  return (
    <Link
      to={to}
      className="group rounded-card border border-stone-200/80 bg-white p-4 shadow-sm transition duration-200 hover:border-brand-200 hover:shadow-md sm:p-5"
    >
      <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        {icon}
      </span>
      <span className="mt-3 block text-2xl font-semibold text-stone-900 tabular-nums">{value ?? "–"}</span>
      <span className="block text-sm text-stone-600">{label}</span>
    </Link>
  );
}

function RecentNotifications({ me }: { me: Me }) {
  const notes = useNotifications();
  return (
    <Card className="p-0 sm:p-0">
      <div className="flex items-center justify-between px-5 pt-5 sm:px-6">
        <h2 className="font-semibold text-stone-900">Recent notifications</h2>
        <Link to="/notifications" className="inline-flex min-h-11 items-center gap-1 rounded-xl text-sm font-medium text-brand-700 hover:text-brand-800">
          See all
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
      <div className="px-5 pb-5 sm:px-6">
        {notes.isPending && (
          <Loading className="space-y-3 pt-2">
            <Bone className="h-12" />
            <Bone className="h-12" />
          </Loading>
        )}
        {notes.isError && <Callout>Could not load notifications: {notes.error.message}</Callout>}
        {notes.data?.length === 0 && (
          <p className="flex items-center gap-3 py-3 text-sm text-stone-500">
            <InboxIcon className="size-5" /> No notifications yet.
          </p>
        )}
        <ul className="divide-y divide-stone-100">
          {notes.data?.slice(0, 3).map((n, i) => (
            <li key={n.id} style={stagger(i)} className="flex items-start gap-3 py-3 motion-safe:animate-rise">
              <NotificationIcon kind={n.kind} />
              <p className={`min-w-0 flex-1 text-sm ${n.readAt ? "text-stone-600" : "font-medium text-stone-900"}`}>{sentence(n, me.timezone)}</p>
              {!n.readAt && <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand-600" />}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function ProfessionalHome({ me }: { me: Me }) {
  const upcoming = useSessions("upcoming");
  const notes = useNotifications();
  const hours = useQuery({ queryKey: ["availability"], queryFn: () => api<Hours[]>("/api/availability") });
  const [now] = useState(() => Date.now());
  const sessions = booked(upcoming.data);
  const today = localDay(new Date(now), me.timezone);
  const dayTitle = (day: string, label: string) => (day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : label);

  return (
    <>
      <PageHeader
        title={<>Welcome, {me.name}</>}
        subtitle="Your agenda at a glance."
        action={
          <Link to="/sessions" className={buttonClass()}>
            <CalendarIcon className="size-4" />
            My schedule
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Stat to="/sessions" label="Next 7 days" value={upcoming.data && sessions.filter((s) => new Date(s.startsAt).getTime() - now < WEEK_MS).length} icon={<CalendarIcon />} />
            <Stat to="/sessions" label="Upcoming" value={upcoming.data && sessions.length} icon={<ClockIcon />} />
            <Stat to="/notifications" label="Unread" value={notes.data?.filter((n) => !n.readAt).length} icon={<BellIcon />} />
          </div>

          <section aria-labelledby="agenda" className="space-y-3">
            <h2 id="agenda" className="text-lg font-semibold text-stone-900">
              Next sessions
            </h2>
            {upcoming.isPending && (
              <Loading className="space-y-3">
                <Bone className="h-20" />
                <Bone className="h-20" />
              </Loading>
            )}
            {upcoming.isError && <Callout>Could not load your sessions: {upcoming.error.message}</Callout>}
            {upcoming.data && sessions.length === 0 && (
              <EmptyState icon={<CalendarIcon />} title="No sessions booked yet">
                Members can book you inside your working hours.
              </EmptyState>
            )}
            {groupByDay(sessions.slice(0, 6), me.timezone).map((g) => (
              <div key={g.day} className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{dayTitle(g.day, g.label)}</h3>
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-card border border-stone-200/80 bg-white shadow-sm">
                  {g.items.map((s, i) => (
                    <li key={s.id} style={stagger(i)} className="flex items-center gap-4 px-5 py-4 motion-safe:animate-rise">
                      <span className="w-28 shrink-0 font-semibold text-stone-900 tabular-nums">
                        {formatRange(new Date(s.startsAt), new Date(s.endsAt), me.timezone)}
                      </span>
                      <Avatar name={s.counterpart.name} size="sm" />
                      <span className="min-w-0 truncate text-stone-700">{s.counterpart.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-stone-900">Your working hours</h2>
              <Link to="/availability" className="inline-flex min-h-11 items-center rounded-xl text-sm font-medium text-brand-700 hover:text-brand-800">
                Edit{" "}<span className="sr-only">working hours</span>
              </Link>
            </div>
            <p className="text-xs text-stone-500" title={zoneTitle(me.timezone)}>
              In {zoneLabel(me.timezone)}
            </p>
            {hours.isPending && (
              <Loading className="mt-3 space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Bone key={i} className="h-5" />
                ))}
              </Loading>
            )}
            {hours.isError && <Callout>Could not load your hours: {hours.error.message}</Callout>}
            {hours.data && (
              <dl className="mt-3 space-y-1.5 text-sm">
                {weekdays.map((name, i) => {
                  const summary = daySummary(hours.data.filter((h) => h.weekday === i + 1));
                  return (
                    <div key={name} className="flex gap-3">
                      <dt className="w-10 shrink-0 font-medium text-stone-700">{name.slice(0, 3)}</dt>
                      <dd className={`min-w-0 tabular-nums ${summary ? "text-stone-700" : "text-stone-400"}`}>{summary ?? "Unavailable"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </Card>
          <RecentNotifications me={me} />
        </div>
      </div>
    </>
  );
}
