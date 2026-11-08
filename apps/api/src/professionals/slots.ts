import { generateSlots, type Interval } from "@thoughtfull/domain";
import { eq } from "drizzle-orm";
import { getWorkingHours } from "../availability/routes.ts";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";

/* eslint-disable @typescript-eslint/no-unused-vars -- the parameters are the contract; sessions are not stored yet */
// Booked sessions of both the professional and the member go here, so a free slot is free for both.
export async function getBusyIntervals(
  _db: Db,
  _who: { professionalId: string; memberId: string },
): Promise<Interval[]> {
  return [];
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export async function listFreeSlots(
  db: Db,
  { professionalId, memberId, now }: { professionalId: string; memberId: string; now: Date },
): Promise<Interval[]> {
  const [pro] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, professionalId));
  if (!pro) return [];
  const [hours, busy] = await Promise.all([
    getWorkingHours(db, professionalId),
    getBusyIntervals(db, { professionalId, memberId }),
  ]);
  return generateSlots({ hours, proZone: pro.timezone, busy, now, windowDays: 28, minNoticeMin: 0 });
}
