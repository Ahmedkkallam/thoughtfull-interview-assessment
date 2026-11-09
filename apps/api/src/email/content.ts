// The reminder email says as little as possible: an inbox is often shared or previewed on a lock screen,
// so it never names the other person or anything about the session beyond its time.
export function reminderEmail(kind: "24h" | "1h", startsAt: Date, timezone: string) {
  // Intl (built into Node) converts with the IANA zone's real rules, so the time is right on either side of
  // a daylight-saving change; the short zone name ("BST", "GMT-4") tells apart the two 01:30s of a fall-back night.
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startsAt);
  const soon = kind === "24h" ? "about 24 hours" : "about 1 hour";
  return {
    subject: "Reminder: you have a session soon",
    body: `Your ThoughtFull session starts in ${soon}: ${when} (${timezone}).\n\nOpen ThoughtFull for the details.\n`,
  };
}
