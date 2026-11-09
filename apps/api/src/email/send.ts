import { and, asc, eq, gt, isNull, lt, lte } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailOutbox, notifications, sessions } from "../db/schema.ts";

// The one thing we need from nodemailer, so tests can pass a fake that records or fails.
export type Mailer = {
  sendMail(msg: { from: string; to: string; subject: string; text: string; messageId: string }): Promise<unknown>;
};

export const MAIL_FROM_DEFAULT = "ThoughtFull <reminders@thoughtfull.local>";
export const MAX_ATTEMPTS = 5;
// Wait after the 1st, 2nd, 3rd and 4th failure; the 5th failure is final.
const RETRY_MINUTES = [1, 5, 15, 15];

/**
 * Sends every queued email that is due and returns how many went out.
 *
 * At-least-once, not exactly-once: the SMTP send cannot be part of a database transaction, so a crash
 * after the server accepted the message but before `sent_at` commits sends it again on the next run.
 * Every attempt uses the same Message-ID (the outbox id), so a duplicate is recognisable as the same message.
 * One email per transaction keeps that duplicate window to a single message.
 */
export async function sendDueEmails(db: Db, mailer: Mailer, now: Date, from = MAIL_FROM_DEFAULT): Promise<number> {
  let sent = 0;
  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: emailOutbox.id, to: emailOutbox.toEmail, subject: emailOutbox.subject, body: emailOutbox.body, attempts: emailOutbox.attempts })
        .from(emailOutbox)
        .innerJoin(notifications, eq(notifications.id, emailOutbox.notificationId))
        .innerJoin(sessions, eq(sessions.id, notifications.sessionId))
        .where(
          and(
            isNull(emailOutbox.sentAt),
            lte(emailOutbox.nextAttemptAt, now),
            lt(emailOutbox.attempts, MAX_ATTEMPTS),
            // A retry that is still waiting when the session is cancelled or starts is dropped, not sent late.
            eq(sessions.status, "booked"),
            gt(sessions.startsAt, now),
          ),
        )
        .orderBy(asc(emailOutbox.nextAttemptAt))
        .limit(1)
        // Held while sending: a second sender skips this email instead of sending it too.
        .for("update", { of: emailOutbox, skipLocked: true });
      if (!row) return false;

      try {
        await mailer.sendMail({ from, to: row.to, subject: row.subject, text: row.body, messageId: `<${row.id}@thoughtfull.local>` });
        await tx.update(emailOutbox).set({ sentAt: now }).where(eq(emailOutbox.id, row.id));
        sent += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const wait = RETRY_MINUTES[attempts - 1];
        // After the last attempt next_attempt_at stays as it is; attempts = MAX_ATTEMPTS keeps it out of the query.
        const nextAttemptAt = wait === undefined ? now : new Date(now.getTime() + wait * 60_000);
        await tx
          .update(emailOutbox)
          .set({ attempts, lastError: String(err instanceof Error ? err.message : err).slice(0, 500), nextAttemptAt })
          .where(eq(emailOutbox.id, row.id));
        if (wait === undefined) console.error(`email ${row.id}: giving up after ${attempts} attempts`);
      }
      return true;
    });
    if (!claimed) return sent;
  }
}
