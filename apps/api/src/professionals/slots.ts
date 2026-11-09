import { generateSlots, localDay, type Interval } from "@thoughtfull/domain";
import { and, eq, gt, or } from "drizzle-orm";
import { getWorkingHours } from "../availability/routes.ts";
import type { Db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import type { Tx } from "../sessions/writes.ts";
import { upcomingBlockedDays } from "../time-off/routes.ts";

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

// Every slot in the professional's working hours for the next 28 days, minus `busy`, their
// blocked days and anything inside their minimum notice.
export async function listWorkingSlots(
  db: Db | Tx,
  { professionalId, now, busy = [] }: { professionalId: string; now: Date; busy?: Interval[] },
): Promise<Interval[]> {
  const [pro] = await db
    .select({ timezone: users.timezone, minNoticeMinutes: users.minNoticeMinutes })
    .from(users)
    .where(eq(users.id, professionalId));
  if (!pro) return [];
  const hours = await getWorkingHours(db, professionalId);
  const blockedDays = await upcomingBlockedDays(db, professionalId, localDay(now, pro.timezone));
  return generateSlots({
    hours,
    proZone: pro.timezone,
    blockedDays,
    busy,
    now,
    windowDays: 28,
    minNoticeMin: pro.minNoticeMinutes,
  });
}

export async function listFreeSlots(
  db: Db,
  { professionalId, memberId, now }: { professionalId: string; memberId: string; now: Date },
): Promise<Interval[]> {
  const busy = await getBusyIntervals(db, { professionalId, memberId, now });
  return listWorkingSlots(db, { professionalId, now, busy });
}
