// The reminder email says as little as possible: an inbox is often shared or previewed on a lock screen,
// so it never names the other person or anything about the session beyond its time.
export const APP_URL_DEFAULT = "http://localhost:5173";

// Every value that goes into the HTML passes through here, so a zone name or URL cannot add markup.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function reminderEmail(
  kind: "24h" | "1h",
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  appUrl: string = process.env.APP_URL || APP_URL_DEFAULT,
) {
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

  // The HTML shows the date and the time range separately, large.
  const part = (opts: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, ...opts }).format(d);
  const clock = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  // Built from parts so the result is "Tuesday 10 November 2026" whatever comma the ICU version puts in.
  const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(startsAt);
  const dateLine = ["weekday", "day", "month", "year"].map((k) => dateParts.find((p) => p.type === k)!.value).join(" ");
  const range = `${part(clock, startsAt)}–${part(clock, endsAt)}`;
  const zoneShort = part({ timeZoneName: "short" }, startsAt).split(", ").pop()!;
  const zoneName = part({ timeZoneName: "longGeneric" }, startsAt).split(", ").pop()!;
  const zoneLine = `${zoneShort} · ${zoneName} (${timezone})`;

  const base = appUrl.replace(/\/+$/, "");
  const label = kind === "24h" ? "Reminder · 24 hours before" : "Reminder · 1 hour before";
  const e = escapeHtml;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your session starts in ${e(soon)}</title></head>
<body style="margin:0;padding:0;background-color:#fafaf9;font-family:${font};color:#292524;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#fafaf9;">Your session starts in ${e(soon)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafaf9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px 4px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background-color:#0f766e;border-radius:10px;color:#ffffff;font-family:${font};font-size:20px;font-weight:700;line-height:36px;">T</td>
<td style="padding-left:12px;font-family:${font};font-size:18px;font-weight:600;color:#292524;">ThoughtFull</td>
</tr></table>
</td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;">
<p style="margin:0 0 12px 0;font-family:${font};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#0f766e;">${e(label)}</p>
<h1 style="margin:0 0 24px 0;font-family:${font};font-size:24px;line-height:32px;font-weight:600;color:#292524;">You have a session coming up</h1>
<p style="margin:0;font-family:${font};font-size:20px;line-height:28px;font-weight:600;color:#292524;">${e(dateLine)}</p>
<p style="margin:4px 0 0 0;font-family:${font};font-size:32px;line-height:40px;font-weight:700;color:#115e59;">${e(range)}</p>
<p style="margin:8px 0 28px 0;font-family:${font};font-size:14px;line-height:20px;color:#78716c;">${e(zoneLine)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="#0f766e" style="background-color:#0f766e;border-radius:10px;"><a href="${e(`${base}/sessions`)}" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open ThoughtFull</a></td>
</tr></table>
<p style="margin:24px 0 0 0;font-family:${font};font-size:13px;line-height:20px;color:#78716c;">For your privacy, we don't include who your session is with.</p>
</td></tr>
<tr><td style="padding:20px 4px 0 4px;font-family:${font};font-size:12px;line-height:18px;color:#78716c;">You get these emails because email reminders are on. <a href="${e(`${base}/settings`)}" style="color:#0f766e;text-decoration:underline;">Turn them off in Settings</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  return {
    subject: "Reminder: you have a session soon",
    body: `Your ThoughtFull session starts in ${soon}: ${when} (${timezone}).\n\nOpen ThoughtFull for the details.\n`,
    html,
  };
}
