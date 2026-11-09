import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatTime, localDay } from "./format.ts";
import { BellIcon, Bone, Button, CalendarIcon, Callout, CrossIcon, EmptyState, InboxIcon, Loading, PageHeader, stagger, Zone } from "./ui.tsx";

export type Notification = {
  id: string;
  kind: "reminder_24h" | "reminder_1h" | "session_cancelled" | "session_rescheduled";
  createdAt: string;
  readAt: string | null;
  session: { id: string; startsAt: string; endsAt: string; counterpart: { name: string } };
};

// Shared with the sidebar and the dashboard so the unread count agrees everywhere; polled so new reminders show up.
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    refetchInterval: 30_000,
  });
}

export function sentence(n: Notification, timezone: string): string {
  const start = new Date(n.session.startsAt);
  const when = `${formatDay(start, timezone)}, ${formatTime(start, timezone)}`;
  const at = `${formatDay(start, timezone)} at ${formatTime(start, timezone)}`;
  const who = n.session.counterpart.name;
  switch (n.kind) {
    case "reminder_24h":
      return `Reminder: your session with ${who} is on ${at} (24-hour reminder)`;
    case "reminder_1h":
      return `Reminder: your session with ${who} is on ${at} (1-hour reminder)`;
    case "session_cancelled":
      return `${who} cancelled your session on ${when}`;
    case "session_rescheduled":
      return `${who} moved their session to ${when}`;
  }
}

const icons: Record<Notification["kind"], { icon: ReactNode; tint: string }> = {
  reminder_24h: { icon: <BellIcon />, tint: "bg-brand-50 text-brand-700" },
  reminder_1h: { icon: <BellIcon />, tint: "bg-brand-50 text-brand-700" },
  session_cancelled: { icon: <CrossIcon />, tint: "bg-rose-50 text-rose-700" },
  session_rescheduled: { icon: <CalendarIcon />, tint: "bg-amber-50 text-amber-700" },
};

export function NotificationIcon({ kind }: { kind: Notification["kind"] }) {
  return (
    <span aria-hidden="true" className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${icons[kind].tint}`}>
      {icons[kind].icon}
    </span>
  );
}

export function NotificationList() {
  const me = useOutletContext<Me>();
  const list = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  // Only used to split "Today" from "Earlier"; read once so the groups do not shift while the page is open.
  const [today] = useState(() => localDay(new Date(), me.timezone));
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => postJson<void>(`/api/notifications/${id}/read`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const all = list.data ?? [];
  const unread = all.filter((n) => !n.readAt);
  const shown = filter === "all" ? all : unread;
  const groups = [
    { title: "Today", items: shown.filter((n) => localDay(new Date(n.createdAt), me.timezone) === today) },
    { title: "Earlier", items: shown.filter((n) => localDay(new Date(n.createdAt), me.timezone) !== today) },
  ].filter((g) => g.items.length > 0);

  const chip = (value: typeof filter, label: string, count: number) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${
        filter === value ? "border-brand-700 bg-brand-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
      }`}
    >
      {label} {count}
    </button>
  );

  return (
    <>
      <PageHeader title="Notifications" subtitle={<Zone prefix="Times shown in " zone={me.timezone} long />} />
      <div className="mx-auto max-w-3xl space-y-5">
        {list.data && list.data.length > 0 && (
          <div role="group" aria-label="Show" className="flex gap-2">
            {chip("all", "All", all.length)}
            {chip("unread", "Unread", unread.length)}
          </div>
        )}
        {list.isPending && (
          <Loading className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl border border-stone-200/80 bg-white p-4">
                <Bone className="size-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-4/5" />
                  <Bone className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </Loading>
        )}
        {list.isError && <Callout>Could not load notifications: {list.error.message}</Callout>}
        {read.isError && <Callout>{read.error.message}</Callout>}
        {list.data?.length === 0 && (
          <EmptyState icon={<InboxIcon />} title="No notifications yet">
            Reminders and changes to your sessions will appear here.
          </EmptyState>
        )}
        {list.data && list.data.length > 0 && shown.length === 0 && (
          <EmptyState icon={<BellIcon />} title="You're all caught up">
            Nothing unread right now.
          </EmptyState>
        )}
        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`notes-${g.title}`} className="space-y-2">
            <h2 id={`notes-${g.title}`} className="px-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
              {g.title}
            </h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-card border border-stone-200/80 bg-white shadow-sm">
              {g.items.map((n, i) => (
                <li
                  key={n.id}
                  style={stagger(i)}
                  className={`relative flex items-start gap-3 px-4 py-4 transition-colors duration-200 motion-safe:animate-rise sm:px-5 ${n.readAt ? "" : "bg-brand-50/50"}`}
                >
                  {/* The unread dot is visual; "Mark as read" and the bold text say the same to everyone. */}
                  <span aria-hidden="true" className={`mt-4 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600 motion-safe:animate-pop"}`} />
                  <NotificationIcon kind={n.kind} />
                  <div className="min-w-0 flex-1">
                    <p className={n.readAt ? "text-stone-600" : "font-medium text-stone-900"}>{sentence(n, me.timezone)}</p>
                    <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
                      {formatDay(new Date(n.createdAt), me.timezone)}, {formatTime(new Date(n.createdAt), me.timezone)}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Button variant="ghost" size="sm" className="shrink-0" onClick={() => read.mutate(n.id)} disabled={read.isPending}>
                      Mark as read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
