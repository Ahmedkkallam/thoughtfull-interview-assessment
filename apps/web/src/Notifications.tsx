import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import { postJson, type Me } from "./auth.ts";
import { formatDay, formatTime } from "./format.ts";

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
  const who = n.session.counterpart.name;
  switch (n.kind) {
    case "reminder_24h":
      return `Reminder: your session with ${who} starts in 24 hours (${when})`;
    case "reminder_1h":
      return `Reminder: your session with ${who} starts in 1 hour (${when})`;
    case "session_cancelled":
      return `${who} cancelled your session on ${when}`;
    case "session_rescheduled":
      return `${who} moved their session to ${when}`;
  }
}

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
      <h1>Notifications</h1>
      <p>Times shown in {me.timezone}</p>
      {list.isPending && <p role="status">Loading…</p>}
      {list.isError && <p role="alert">Could not load notifications: {list.error.message}</p>}
      {read.isError && <p role="alert">{read.error.message}</p>}
      {list.data?.length === 0 && <p>No notifications yet.</p>}
      <ul className="plain">
        {list.data?.map((n) => (
          <li key={n.id} className="session">
            <span style={{ fontWeight: n.readAt ? "normal" : "bold" }}>{sentence(n, me.timezone)}</span>{" "}
            {!n.readAt && (
              <button type="button" onClick={() => read.mutate(n.id)} disabled={read.isPending}>
                Mark as read
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
