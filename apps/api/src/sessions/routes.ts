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

// z.object drops unknown keys: a client-sent member id or end time never reaches the database.
const bookBody = z.object({
  professionalId: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
});

const listQuery = z.object({ scope: z.enum(["upcoming", "past"]).default("upcoming") });

export function sessionRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  app.post("/api/sessions", { preHandler: requireRole("member") }, async (req, reply) => {
    const body = bookBody.parse(req.body);
    const pro = await findProfessional(db, body.professionalId);

    // The start must be on the professional's slot grid, which rules out past, off-grid,
    // outside-hours and beyond-28-days times. Other bookings are not checked here on purpose:
    // the database constraints decide, and they also hold when two requests race.
    const startsAt = new Date(body.startsAt).getTime();
    const slots = await listWorkingSlots(db, { professionalId: pro.id, now: clock.now() });
    const slot = slots.find((s) => s.startsAt.getTime() === startsAt);
    if (!slot) throw new HttpError(422, "SLOT_NOT_AVAILABLE", "This time is not one of the professional's slots");

    // A plain insert: an overlap or a past start fails here and errors.ts turns it into 409 or 422.
    const [row] = await db
      .insert(sessions)
      .values({ professionalId: pro.id, memberId: req.user!.id, startsAt: slot.startsAt, endsAt: slot.endsAt })
      .returning({ id: sessions.id, startsAt: sessions.startsAt, endsAt: sessions.endsAt, status: sessions.status });

    return reply.status(201).send({
      id: row!.id,
      startsAt: row!.startsAt.toISOString(),
      endsAt: row!.endsAt.toISOString(),
      status: row!.status,
      professional: pro,
    });
  });

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
        // Only public fields of the other person: never an email.
        counterpart: { id: users.id, name: users.name, timezone: users.timezone },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, theirs))
      .where(and(eq(mine, me.id), inScope))
      .orderBy(scope === "upcoming" ? asc(sessions.startsAt) : desc(sessions.startsAt));

    return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
  });
}
