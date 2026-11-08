import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/guards.ts";
import type { Clock } from "../clock.ts";
import type { Db } from "../db/client.ts";
import { notifications, sessions, users } from "../db/schema.ts";
import { HttpError } from "../errors.ts";

export function notificationRoutes(app: FastifyInstance, { db, clock }: { db: Db; clock: Clock }) {
  app.get("/api/notifications", { preHandler: requireAuth }, async (req) => {
    const me = req.user!;
    // The person the caller meets in that session; only their name leaves the server.
    const theirs = me.role === "member" ? sessions.professionalId : sessions.memberId;
    const rows = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
        session: { id: sessions.id, startsAt: sessions.startsAt, endsAt: sessions.endsAt },
        counterpartName: users.name,
      })
      .from(notifications)
      .innerJoin(sessions, eq(sessions.id, notifications.sessionId))
      .innerJoin(users, eq(users.id, theirs))
      .where(eq(notifications.userId, me.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
      session: {
        id: r.session.id,
        startsAt: r.session.startsAt.toISOString(),
        endsAt: r.session.endsAt.toISOString(),
        counterpart: { name: r.counterpartName },
      },
    }));
  });

  app.post<{ Params: { id: string } }>("/api/notifications/:id/read", { preHandler: requireAuth }, async (req, reply) => {
    const notFound = new HttpError(404, "NOT_FOUND", "Notification not found");
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw notFound;
    // Matching on the caller's id too: someone else's notification looks exactly like a missing one.
    const [row] = await db
      .update(notifications)
      // coalesce keeps the first read time when the same notification is marked twice.
      .set({ readAt: sql`coalesce(${notifications.readAt}, ${clock.now().toISOString()}::timestamptz)` })
      .where(and(eq(notifications.id, id.data), eq(notifications.userId, req.user!.id)))
      .returning({ id: notifications.id });
    if (!row) throw notFound;
    return reply.status(204).send();
  });
}
