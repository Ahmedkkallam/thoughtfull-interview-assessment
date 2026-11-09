import { setTimeout as sleep } from "node:timers/promises";
import nodemailer from "nodemailer";
import pg from "pg";
import { systemClock } from "./clock.ts";
import { createDb } from "./db/client.ts";
import { MAIL_FROM_DEFAULT, sendDueEmails } from "./email/send.ts";
import { deliverDueReminders } from "./reminders/deliver.ts";

// A separate process from the API: running more API copies never runs more pollers by accident,
// and an API crash does not stop reminders.
const POLL_MS = 5000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: databaseUrl });
pool.on("error", (err) => console.error("idle database connection error", err));
const db = createDb(pool);

// On Ctrl+C or a container stop, let the current run commit, then exit.
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.abort());

// Local Mailpit only (docker-compose.yml); without SMTP_URL, emails stay queued in email_outbox.
const smtpUrl = process.env.SMTP_URL;
const mailFrom = process.env.MAIL_FROM || MAIL_FROM_DEFAULT;
// Short timeouts: the sender holds a database transaction open while one email is being sent.
const mailer = smtpUrl
  ? nodemailer.createTransport({ url: smtpUrl, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 })
  : null;
if (!mailer) console.log("email: SMTP_URL not set, emails stay queued");

console.log("reminder worker started");
while (!stop.signal.aborted) {
  try {
    const delivered = await deliverDueReminders(db, systemClock.now());
    if (delivered > 0) console.log(`delivered ${delivered} reminder notification(s)`);
  } catch (err) {
    // The failed batch was rolled back, so its reminders are simply picked up on the next run.
    console.error("reminder delivery failed", err);
  }
  if (mailer) {
    try {
      const sent = await sendDueEmails(db, mailer, systemClock.now(), mailFrom);
      if (sent > 0) console.log(`sent ${sent} reminder email(s)`);
    } catch (err) {
      // A failed send is recorded on its row and retried later; this catches database errors only.
      console.error("email sending failed", err);
    }
  }
  await sleep(POLL_MS, undefined, { signal: stop.signal }).catch(() => {});
}
await pool.end();
console.log("reminder worker stopped");
