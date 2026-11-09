import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guards.ts";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";

// A short fixed list keeps the setting easy to choose and to explain; the database CHECK holds the same list.
export const NOTICE_OPTIONS = [0, 60, 120, 240, 720, 1440, 2880] as const;

const putBody = z.object({ minNoticeMinutes: z.literal(NOTICE_OPTIONS) });

export function bookingSettingsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const professionalOnly = { preHandler: requireRole("professional") };

  app.get("/api/booking-settings", professionalOnly, async (req) => {
    const [row] = await db
      .select({ minNoticeMinutes: users.minNoticeMinutes })
      .from(users)
      .where(eq(users.id, req.user!.id));
    return row!;
  });

  app.put("/api/booking-settings", professionalOnly, async (req) => {
    const { minNoticeMinutes } = putBody.parse(req.body);
    const [row] = await db
      .update(users)
      .set({ minNoticeMinutes })
      .where(eq(users.id, req.user!.id))
      .returning({ minNoticeMinutes: users.minNoticeMinutes });
    return row!;
  });
}
