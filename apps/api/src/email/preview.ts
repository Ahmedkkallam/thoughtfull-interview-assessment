// Sends one 24 h and one 1 h sample reminder to the local Mailpit (http://localhost:8025) so the design
// can be looked at. It does not touch the database.
import nodemailer from "nodemailer";
import { reminderEmail } from "./content.ts";
import { MAIL_FROM_DEFAULT } from "./send.ts";

const transport = nodemailer.createTransport({ url: process.env.SMTP_URL || "smtp://localhost:1025" });

// A fictional session: Tuesday 10 November 2026, 17:00 to 17:50 in Singapore.
const startsAt = new Date("2026-11-10T09:00:00Z");
const endsAt = new Date("2026-11-10T09:50:00Z");

for (const kind of ["24h", "1h"] as const) {
  const { subject, body, html } = reminderEmail(kind, startsAt, endsAt, "Asia/Singapore");
  await transport.sendMail({
    from: process.env.MAIL_FROM || MAIL_FROM_DEFAULT,
    to: "preview@example.test",
    subject: `${subject} (preview, ${kind})`,
    text: body,
    html,
  });
  console.log(`sent ${kind} preview`);
}
transport.close();
