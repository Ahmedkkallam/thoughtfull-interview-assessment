import { daysBetween, localDay, localDayBounds } from "@thoughtfull/domain";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guards.ts";
import type { Clock } from "../clock.ts";
import type { Db } from "../db/client.ts";
import { blockedDates, sessions, users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";
import { lockPeople, type Tx } from "../sessions/writes.ts";

// z.iso.date() accepts only real calendar dates ("2027-02-30" fails).
const postBody = z.object({
  day: z.iso.date(),
  // Blank becomes null, so "no reason" has one shape.
  reason: z.string().trim().max(80).optional().transform((r) => r || null),
});

const MAX_DAYS_AHEAD = 365;

// Days come back from the database as "yyyy-MM-dd" text (mode: "string"), never as a Date.
export async function upcomingBlockedDays(db: Db | Tx, professionalId: string, today: string): Promise<string[]> {
  const rows = await db
    .select({ day: blockedDates.day })
    .from(blockedDates)
    .where(and(eq(blockedDates.professionalId, professionalId), gte(blockedDates.day, today)));
  return rows.map((r) => r.day);
}

// Booked sessions per local day, so the professional sees what a blocked day still holds.
// Day bounds come from the domain (Luxon), so a 23- or 25-hour day counts right.
async function bookedSessionsByDay(db: Db | Tx, professionalId: string, zone: string, days: string[]) {
  const counts = new Map(days.map((d) => [d, 0]));
  if (days.length === 0) return counts;
  const rows = await db
    .select({ startsAt: sessions.startsAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.professionalId, professionalId),
        eq(sessions.status, "booked"),
        gte(sessions.startsAt, localDayBounds(days[0]!, zone).startsAt),
        lt(sessions.startsAt, localDayBounds(days.at(-1)!, zone).endsAt),
      ),
    );
  for (const { startsAt } of rows) {
    const day = localDay(startsAt, zone);
    if (counts.has(day)) counts.set(day, counts.get(day)! + 1);
  }
  return counts;
}

async function zoneOf(db: Db, professionalId: string): Promise<string> {
  const [row] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, professionalId));
  return row!.timezone;
}

const notFound = () => new HttpError(404, "NOT_FOUND", "Blocked day not found");

export function timeOffRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  const professionalOnly = { preHandler: requireRole("professional") };

  // Every query filters on the caller's own id: another professional's days are simply not there.
  app.get("/api/blocked-dates", professionalOnly, async (req) => {
    const me = req.user!.id;
    const zone = await zoneOf(db, me);
    const rows = await db
      .select({ day: blockedDates.day, reason: blockedDates.reason })
      .from(blockedDates)
      .where(and(eq(blockedDates.professionalId, me), gte(blockedDates.day, localDay(clock.now(), zone))))
      .orderBy(asc(blockedDates.day));
    const counts = await bookedSessionsByDay(db, me, zone, rows.map((r) => r.day));
    return rows.map((r) => ({ ...r, bookedSessions: counts.get(r.day)! }));
  });

  // Blocking does not cancel sessions already booked on the day (like changing hours); the
  // count in the answer lets the professional decide whether to cancel them.
  app.post("/api/blocked-dates", professionalOnly, async (req, reply) => {
    const { day, reason } = postBody.parse(req.body);
    const me = req.user!.id;
    const zone = await zoneOf(db, me);
    const today = localDay(clock.now(), zone);
    if (day < today) throw new HttpError(422, "PAST_DAY", "That day has already passed.");
    if (daysBetween(today, day) > MAX_DAYS_AHEAD) {
      throw new HttpError(422, "TOO_FAR", `Time off can be set at most ${MAX_DAYS_AHEAD} days ahead.`);
    }

    const item = await db.transaction(async (tx) => {
      // Same lock as booking: a booking racing for this day either commits first (and is counted
      // below) or waits and then sees the block. A duplicate day fails on the primary key (409).
      await lockPeople(tx, [me]);
      await tx.insert(blockedDates).values({ professionalId: me, day, reason });
      const counts = await bookedSessionsByDay(tx, me, zone, [day]);
      return { day, reason, bookedSessions: counts.get(day)! };
    });
    return reply.status(201).send(item);
  });

  app.delete<{ Params: { day: string } }>("/api/blocked-dates/:day", professionalOnly, async (req, reply) => {
    const day = z.iso.date().safeParse(req.params.day);
    if (!day.success) throw notFound();
    const deleted = await db
      .delete(blockedDates)
      .where(and(eq(blockedDates.professionalId, req.user!.id), eq(blockedDates.day, day.data)))
      .returning({ day: blockedDates.day });
    if (deleted.length === 0) throw notFound();
    return reply.status(204).send();
  });
}
