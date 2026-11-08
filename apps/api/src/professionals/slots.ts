import { generateSlots, type Interval } from "@thoughtfull/domain";
import { and, eq, gt, or } from "drizzle-orm";
import { getWorkingHours } from "../availability/routes.ts";
import type { Db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";

// Booked sessions of both the professional and the member, so a listed slot is free for both.
export async function getBusyIntervals(
  db: Db,
  { professionalId, memberId, now }: { professionalId: string; memberId: string; now: Date },
): Promise<Interval[]> {
  return db
    .select({ startsAt: sessions.startsAt, endsAt: sessions.endsAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "booked"),
        gt(sessions.endsAt, now),
        or(eq(sessions.professionalId, professionalId), eq(sessions.memberId, memberId)),
      ),
    );
}

// Every slot in the professional's working hours for the next 28 days, minus `busy`.
export async function listWorkingSlots(
  db: Db,
  { professionalId, now, busy = [] }: { professionalId: string; now: Date; busy?: Interval[] },
): Promise<Interval[]> {
  const [pro] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, professionalId));
  if (!pro) return [];
  const hours = await getWorkingHours(db, professionalId);
  return generateSlots({ hours, proZone: pro.timezone, busy, now, windowDays: 28, minNoticeMin: 0 });
}

export async function listFreeSlots(
  db: Db,
  { professionalId, memberId, now }: { professionalId: string; memberId: string; now: Date },
): Promise<Interval[]> {
  const busy = await getBusyIntervals(db, { professionalId, memberId, now });
  return listWorkingSlots(db, { professionalId, now, busy });
}
