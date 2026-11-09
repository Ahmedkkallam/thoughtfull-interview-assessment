import { and, asc, desc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/guards.ts";
import type { Clock } from "../clock.ts";
import type { Db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";
import { findProfessional } from "../professionals/routes.ts";
import { listWorkingSlots } from "../professionals/slots.ts";
import { isBlockedDay } from "../time-off/routes.ts";
import { assertChangeable, cancelSession, insertSession, lockPeople, notFound, notify, ownSession } from "./writes.ts";

// z.object drops unknown keys: a client-sent member id or end time never reaches the database.
const bookBody = z.object({
  professionalId: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
});

const rescheduleBody = z.object({ startsAt: z.iso.datetime({ offset: true }) });

const listQuery = z.object({ scope: z.enum(["upcoming", "past"]).default("upcoming") });

export function sessionRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  app.post("/api/sessions", { preHandler: requireRole("member") }, async (req, reply) => {
    const body = bookBody.parse(req.body);
    const pro = await findProfessional(db, body.professionalId);
    const now = clock.now();

    const slot = await findSlot(db, pro.id, body.startsAt, now);
    if (!slot) throw unavailable(pro, body.startsAt, now);

    const row = await db.transaction(async (tx) => {
      await lockPeople(tx, [req.user!.id, pro.id]);
      // Asked again under the lock: the professional may have blocked the day since findSlot read it.
      if (await isBlockedDay(tx, pro, slot.startsAt)) throw slotNotAvailable();
      return insertSession(tx, { professionalId: pro.id, memberId: req.user!.id, slot, now });
    });

    return reply.status(201).send(bookingJson(row, pro));
  });

  // Either person on the session may cancel it; the other one is told in the app.
  app.post<{ Params: { id: string } }>("/api/sessions/:id/cancel", { preHandler: requireAuth }, async (req) => {
    const me = req.user!;
    const now = clock.now();
    const row = await db.transaction(async (tx) => {
      // A racing cancel or reschedule of this session waits here, then sees the new status.
      // NO KEY UPDATE, not UPDATE: the reminder worker, holding this session's reminders, inserts
      // notifications whose foreign key takes a light lock on this row. UPDATE would block that while
      // this cancel waits for those reminders: a deadlock. The status change needs no stronger lock.
      const [s] = await tx
        .select({
          id: sessions.id,
          status: sessions.status,
          startsAt: sessions.startsAt,
          memberId: sessions.memberId,
          professionalId: sessions.professionalId,
        })
        .from(sessions)
        .where(ownSession(req.params.id, me))
        .for("no key update");
      if (!s) throw notFound();
      assertChangeable(s, me.role, now);
      const cancelled = await cancelSession(tx, { id: s.id, by: me.id, reason: me.role, now });
      const other = me.role === "member" ? s.professionalId : s.memberId;
      await notify(tx, { userId: other, sessionId: s.id, kind: "session_cancelled", now });
      return cancelled;
    });
    return {
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status,
      cancelReason: row.cancelReason,
    };
  });

  // A reschedule is a new session with the same professional plus the old one cancelled, in one
  // transaction (READ COMMITTED, the default): any failure rolls back both, so the member never
  // ends up with no session or with two.
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/reschedule",
    { preHandler: requireRole("member") },
    async (req, reply) => {
      const body = rescheduleBody.parse(req.body);
      const me = req.user!;
      const now = clock.now();

      // Who the session is with never changes, so it can be read before the locks to know whom to lock.
      const [old] = await db
        .select({ id: sessions.id, professionalId: sessions.professionalId })
        .from(sessions)
        .where(ownSession(req.params.id, me));
      if (!old) throw notFound();
      const pro = await findProfessional(db, old.professionalId);
      const slot = await findSlot(db, pro.id, body.startsAt, now);

      const row = await db.transaction(async (tx) => {
        // Same order as booking (both people, then the session), so a reschedule and a booking
        // of the same professional queue up instead of deadlocking.
        await lockPeople(tx, [me.id, old.professionalId]);
        const [locked] = await tx
          .select({ status: sessions.status, startsAt: sessions.startsAt })
          .from(sessions)
          .where(eq(sessions.id, old.id))
          // NO KEY UPDATE for the same reason as in cancel: the reminder worker must not deadlock with it.
          .for("no key update");
        assertChangeable(locked!, "member", now);
        // Otherwise the member would get a new session at the same time and the professional a "moved" notice.
        if (locked!.startsAt.getTime() === new Date(body.startsAt).getTime()) {
          throw new HttpError(422, "SAME_TIME", "That is already the time of this session.");
        }
        if (!slot) throw unavailable(pro, body.startsAt, now);
        // Same re-check under the lock as booking.
        if (await isBlockedDay(tx, pro, slot.startsAt)) throw slotNotAvailable();

        // Cancel first: otherwise the member's own old session blocks a new time that overlaps it.
        await cancelSession(tx, { id: old.id, by: me.id, reason: "rescheduled", now });
        const session = await insertSession(tx, {
          professionalId: old.professionalId,
          memberId: me.id,
          slot,
          now,
          rescheduledFrom: old.id,
        });
        await notify(tx, { userId: old.professionalId, sessionId: session.id, kind: "session_rescheduled", now });
        return session;
      });

      return reply.status(201).send(bookingJson(row, pro));
    },
  );

  app.get("/api/sessions", { preHandler: requireAuth }, async (req) => {
    const { scope } = listQuery.parse(req.query);
    const me = req.user!;
    const now = clock.now();

    // Rows where the caller is this side are theirs; the other side is the person they meet.
    const [mine, theirs] =
      me.role === "member" ? [sessions.memberId, sessions.professionalId] : [sessions.professionalId, sessions.memberId];

    const inScope =
      scope === "upcoming"
        ? and(eq(sessions.status, "booked"), gt(sessions.endsAt, now))
        : and(
            or(lte(sessions.endsAt, now), eq(sessions.status, "cancelled")),
            // The old row of a reschedule is not a session anyone had; its replacement is listed instead.
            or(isNull(sessions.cancelReason), ne(sessions.cancelReason, "rescheduled")),
          );

    const rows = await db
      .select({
        id: sessions.id,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        status: sessions.status,
        cancelReason: sessions.cancelReason,
        // Never an email.
        counterpart: { id: users.id, name: users.name, timezone: users.timezone },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, theirs))
      .where(and(eq(mine, me.id), inScope))
      .orderBy(scope === "upcoming" ? asc(sessions.startsAt) : desc(sessions.startsAt));

    return rows.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      // A member needs the professional's id (to reschedule) and zone; a professional only the member's name.
      counterpart: me.role === "member" ? r.counterpart : { name: r.counterpart.name },
    }));
  });
}

// The start must be on the professional's slot grid, which rules out past, off-grid,
// outside-hours, beyond-28-days, blocked-day and inside-the-notice times. Other bookings are not checked here on purpose:
// the database constraints decide, and they also hold when two requests race.
async function findSlot(db: Db, professionalId: string, startsAtIso: string, now: Date) {
  const startsAt = new Date(startsAtIso).getTime();
  const slots = await listWorkingSlots(db, { professionalId, now });
  return slots.find((s) => s.startsAt.getTime() === startsAt);
}

const slotNotAvailable = () =>
  new HttpError(422, "SLOT_NOT_AVAILABLE", "This time is not one of the professional's slots");

// Picks the error for a start that is not a slot. Inside the notice window the member is told why;
// anything else, a blocked day included, is just "not available", so time off is never revealed.
function unavailable(pro: { minNoticeMinutes: number }, startsAtIso: string, now: Date) {
  const ahead = new Date(startsAtIso).getTime() - now.getTime();
  if (ahead > 0 && ahead < pro.minNoticeMinutes * 60_000) {
    const hours = pro.minNoticeMinutes / 60; // every allowed notice is whole hours
    return new HttpError(422, "TOO_SOON", `This professional needs at least ${hours} hour${hours === 1 ? "" : "s"} notice.`);
  }
  return slotNotAvailable();
}

function bookingJson(
  row: { id: string; startsAt: Date; endsAt: Date; status: string },
  { id, name, timezone }: { id: string; name: string; timezone: string },
) {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    professional: { id, name, timezone },
  };
}
