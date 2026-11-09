import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guards.ts";
import type { Clock } from "../clock.ts";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";
import type { Tx } from "../sessions/writes.ts";
import { listFreeSlots } from "./slots.ts";

// Only these columns leave the server: no email, no hash.
const publicColumns = { id: users.id, name: users.name, timezone: users.timezone };

// A malformed id is just "not found", so Postgres never sees it and cannot throw.
// The notice is public: a member needs it to understand why near slots are missing.
export async function findProfessional(db: Db | Tx, rawId: string) {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) throw new HttpError(404, "NOT_FOUND", "Professional not found");
  const [pro] = await db
    .select({ ...publicColumns, minNoticeMinutes: users.minNoticeMinutes })
    .from(users)
    .where(and(eq(users.id, id.data), eq(users.role, "professional")));
  if (!pro) throw new HttpError(404, "NOT_FOUND", "Professional not found");
  return pro;
}

export function professionalRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  const memberOnly = { preHandler: requireRole("member") };

  app.get("/api/professionals", memberOnly, async () =>
    db.select(publicColumns).from(users).where(eq(users.role, "professional")).orderBy(asc(users.name)),
  );

  app.get<{ Params: { id: string } }>("/api/professionals/:id", memberOnly, async (req) =>
    findProfessional(db, req.params.id),
  );

  app.get<{ Params: { id: string } }>("/api/professionals/:id/slots", memberOnly, async (req) => {
    const pro = await findProfessional(db, req.params.id);
    const slots = await listFreeSlots(db, { professionalId: pro.id, memberId: req.user!.id, now: clock.now() });
    // Only the times: never who booked a taken slot.
    return { slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })) };
  });
}
