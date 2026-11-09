import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatTime } from "./format.ts";
import { BellIcon, Button, CalendarIcon, Callout, Card, CrossIcon, PageHeader, Skeleton, Zone } from "./ui.tsx";

type Notification = {
  id: string;
  kind: "reminder_24h" | "reminder_1h" | "session_cancelled" | "session_rescheduled";
  createdAt: string;
  readAt: string | null;
  session: { id: string; startsAt: string; endsAt: string; counterpart: { name: string } };
};

// Shared with the header so the unread count and the page agree; polled so new reminders show up.
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    refetchInterval: 30_000,
  });
}

function sentence(n: Notification, timezone: string): string {
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

export function NotificationList() {
  const me = useOutletContext<Me>();
  const list = useNotifications();
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => postJson<void>(`/api/notifications/${id}/read`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <>
      <PageHeader title="Notifications" subtitle={<Zone prefix="Times shown in " zone={me.timezone} long />} />
      <div className="space-y-3">
        {list.isPending && <Skeleton rows={3} />}
        {list.isError && <Callout>Could not load notifications: {list.error.message}</Callout>}
        {read.isError && <Callout>{read.error.message}</Callout>}
        {list.data?.length === 0 && <Card className="text-sm text-stone-600">No notifications yet.</Card>}
        <ul className="space-y-2">
          {list.data?.map((n) => (
            <li
              key={n.id}
              className={`flex items-start gap-3 rounded-2xl border p-4 transition-colors duration-200 ${
                n.readAt ? "border-stone-200/80 bg-white" : "border-brand-200 bg-brand-50/60"
              }`}
            >
              <span aria-hidden="true" className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${icons[n.kind].tint}`}>
                {icons[n.kind].icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={n.readAt ? "text-stone-600" : "font-medium text-stone-900"}>{sentence(n, me.timezone)}</p>
                {!n.readAt && (
                  <Button variant="ghost" size="sm" className="-ml-3" onClick={() => read.mutate(n.id)} disabled={read.isPending}>
                    Mark as read
                  </Button>
                )}
              </div>
              {!n.readAt && <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-brand-600 motion-safe:animate-pop" />}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
