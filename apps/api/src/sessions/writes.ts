import { canMemberChange, reminderSchedule, type Interval } from "@thoughtfull/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AuthUser } from "../auth/sessions.ts";
import type { Db } from "../db/client.ts";
import { notifications, reminders, sessions, users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";

// Booking, cancelling and rescheduling write through these helpers, so the three always lock,
// insert and cancel the same way.

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const TOO_LATE_MESSAGE = "Sessions can't be cancelled or rescheduled less than 24 hours before they start.";

const sessionColumns = {
  id: sessions.id,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  status: sessions.status,
  cancelReason: sessions.cancelReason,
};

export const notFound = () => new HttpError(404, "NOT_FOUND", "Session not found");

// "This id, and the caller is on it." Someone else's session looks exactly like a missing one,
// and a malformed id never reaches Postgres.
export function ownSession(rawId: string, me: AuthUser) {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) throw notFound();
  const mine = me.role === "member" ? sessions.memberId : sessions.professionalId;
  return and(eq(sessions.id, id.data), eq(mine, me.id));
}

// Racing inserts can deadlock inside the overlap check, which Postgres reports as an error (a 500).
// Locking both people's rows first, always in id order, makes their changes take turns instead;
// the constraints still decide who wins. NO KEY UPDATE does not block logins or other foreign keys.
export async function lockPeople(tx: Tx, ids: string[]) {
  await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.id))
    .for("no key update");
}

// The session and its reminders are written together, so a booking never exists without its reminders.
// An overlap or a past start fails the insert; the error leaves the transaction and errors.ts maps it.
export async function insertSession(
  tx: Tx,
  p: { professionalId: string; memberId: string; slot: Interval; now: Date; rescheduledFrom?: string },
) {
  const [session] = await tx
    .insert(sessions)
    .values({
      professionalId: p.professionalId,
      memberId: p.memberId,
      startsAt: p.slot.startsAt,
      endsAt: p.slot.endsAt,
      rescheduledFrom: p.rescheduledFrom,
    })
    .returning(sessionColumns);
  const planned = reminderSchedule({ startsAt: p.slot.startsAt, memberId: p.memberId, professionalId: p.professionalId, now: p.now });
  if (planned.length > 0) {
    await tx.insert(reminders).values(planned.map((r) => ({ sessionId: session!.id, ...r })));
  }
  return session!;
}

// Checked on the row read under its lock, so a racing change cannot slip in between check and write.
export function assertChangeable(session: { status: string; startsAt: Date }, role: AuthUser["role"], now: Date) {
  if (session.status !== "booked") {
    throw new HttpError(409, "NOT_ACTIVE", "This session has already been cancelled or rescheduled");
  }
  if (session.startsAt.getTime() <= now.getTime()) {
    throw new HttpError(409, "STARTED", "This session has already started");
  }
  // Professionals may cancel any time before the start; members only up to 24 hours before.
  if (role === "member" && !canMemberChange(session.startsAt, now)) {
    throw new HttpError(409, "TOO_LATE", TOO_LATE_MESSAGE);
  }
}

// Cancelling frees the time (the overlap constraints only count booked rows) and stops its reminders.
export async function cancelSession(
  tx: Tx,
  p: { id: string; by: string; reason: "member" | "professional" | "rescheduled"; now: Date },
) {
  const [row] = await tx
    .update(sessions)
    .set({ status: "cancelled", cancelledAt: p.now, cancelledBy: p.by, cancelReason: p.reason })
    .where(eq(sessions.id, p.id))
    .returning(sessionColumns);
  // Only reminders still waiting; a delivered one stays as the record of what was sent.
  await tx
    .update(reminders)
    .set({ cancelledAt: p.now })
    .where(and(eq(reminders.sessionId, p.id), isNull(reminders.deliveredAt), isNull(reminders.cancelledAt)));
  return row!;
}

export async function notify(
  tx: Tx,
  p: { userId: string; sessionId: string; kind: "session_cancelled" | "session_rescheduled"; now: Date },
) {
  await tx.insert(notifications).values({ userId: p.userId, sessionId: p.sessionId, kind: p.kind, createdAt: p.now });
}
