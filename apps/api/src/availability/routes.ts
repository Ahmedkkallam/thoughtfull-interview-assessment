import { validateWeek, type WorkingHours } from "@thoughtfull/domain";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guards.ts";
import type { Db } from "../db/client.ts";
import { workingHours } from "../db/schema.ts";
import { HttpError } from "../errors.ts";

// Only the shape is checked here; weekday range, time format, overlaps and midnight are validateWeek's job.
const putBody = z.object({
  hours: z.array(z.object({ weekday: z.number().int(), start: z.string(), end: z.string() })).max(100),
});

// Postgres returns time as "09:00:00"; the API speaks "HH:mm".
const hhmm = (t: string) => t.slice(0, 5);

export async function getWorkingHours(db: Db, professionalId: string): Promise<WorkingHours[]> {
  const rows = await db
    .select({ weekday: workingHours.weekday, start: workingHours.startTime, end: workingHours.endTime })
    .from(workingHours)
    .where(eq(workingHours.professionalId, professionalId))
    .orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
  return rows.map((r) => ({ weekday: r.weekday, start: hhmm(r.start), end: hhmm(r.end) }));
}

// Delete + insert in one transaction: a failed insert rolls back, so the old week is never half-replaced.
export async function replaceWorkingHours(db: Db, professionalId: string, hours: WorkingHours[]) {
  await db.transaction(async (tx) => {
    await tx.delete(workingHours).where(eq(workingHours.professionalId, professionalId));
    if (hours.length > 0) {
      await tx
        .insert(workingHours)
        .values(hours.map((h) => ({ professionalId, weekday: h.weekday, startTime: h.start, endTime: h.end })));
    }
  });
}

export function availabilityRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const professionalOnly = { preHandler: requireRole("professional") };

  app.get("/api/availability", professionalOnly, async (req) => getWorkingHours(db, req.user!.id));

  app.put("/api/availability", professionalOnly, async (req) => {
    const { hours } = putBody.parse(req.body);
    const problems = validateWeek(hours);
    if (problems.length > 0) throw new HttpError(400, "INVALID_HOURS", problems.join("; "));
    await replaceWorkingHours(db, req.user!.id, hours);
    return getWorkingHours(db, req.user!.id);
  });
}
