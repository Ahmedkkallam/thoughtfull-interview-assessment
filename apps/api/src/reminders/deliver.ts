import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailOutbox, notifications, reminders, sessions, users } from "../db/schema.ts";
import { reminderEmail } from "../email/content.ts";

const BATCH_SIZE = 50;

/**
 * Turns every due reminder into an in-app notification, exactly once, and returns how many it delivered.
 * Each batch is one transaction: the notifications, their queued emails and `delivered_at` commit together
 * or not at all, so a crash at any point either leaves the reminder pending (retried next run) or fully delivered.
 */
export async function deliverDueReminders(
  db: Db,
  now: Date,
  // Test-only: runs after the notifications and emails are inserted and before the commit, so a test can
  // throw here to simulate the process dying mid-delivery, or pause here to hold the row locks.
  opts: { afterInsert?: () => void | Promise<void> } = {},
): Promise<number> {
  let delivered = 0;
  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const due = await tx
        .select({
          id: reminders.id,
          sessionId: reminders.sessionId,
          recipientId: reminders.recipientId,
          kind: reminders.kind,
          startsAt: sessions.startsAt,
          email: users.email,
          timezone: users.timezone,
          emailReminders: users.emailReminders,
        })
        .from(reminders)
        .innerJoin(sessions, eq(sessions.id, reminders.sessionId))
        .innerJoin(users, eq(users.id, reminders.recipientId))
        .where(
          and(
            isNull(reminders.deliveredAt),
            isNull(reminders.cancelledAt),
            lte(reminders.dueAt, now),
            // A late reminder (the worker was down) still goes out while the session is ahead; never after it starts.
            eq(sessions.status, "booked"),
            gt(sessions.startsAt, now),
          ),
        )
        .orderBy(asc(reminders.dueAt))
        .limit(BATCH_SIZE)
        // Lock only the reminder rows; another worker skips them instead of waiting or sending them twice.
        .for("update", { of: reminders, skipLocked: true });
      if (due.length === 0) return 0;

      // The UNIQUE reminder_id is a second guard: even a bug here cannot create a duplicate.
      const inserted = await tx
        .insert(notifications)
        .values(
          due.map((r) => ({
            userId: r.recipientId,
            sessionId: r.sessionId,
            kind: r.kind === "24h" ? ("reminder_24h" as const) : ("reminder_1h" as const),
            reminderId: r.id,
            createdAt: now,
          })),
        )
        .onConflictDoNothing({ target: notifications.reminderId })
        .returning({ id: notifications.id, reminderId: notifications.reminderId });

      // Queue the email in this same transaction: it commits with the notification or not at all.
      const byId = new Map(due.map((r) => [r.id, r]));
      const emails = inserted.flatMap(({ id, reminderId }) => {
        const r = byId.get(reminderId!)!;
        if (!r.emailReminders) return [];
        const { subject, body } = reminderEmail(r.kind, r.startsAt, r.timezone);
        return [{ notificationId: id, toEmail: r.email, subject, body, createdAt: now, nextAttemptAt: now }];
      });
      if (emails.length > 0) {
        await tx.insert(emailOutbox).values(emails).onConflictDoNothing({ target: emailOutbox.notificationId });
      }
      await opts.afterInsert?.();
      await tx
        .update(reminders)
        .set({ deliveredAt: now })
        .where(inArray(reminders.id, due.map((r) => r.id)));
      delivered += inserted.length;
      return due.length;
    });
    if (claimed === 0) return delivered;
  }
}
