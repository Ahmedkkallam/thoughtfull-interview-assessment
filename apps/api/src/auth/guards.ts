import type { FastifyRequest } from "fastify";
import { HttpError } from "../errors.ts";
import type { AuthUser } from "./sessions.ts";

declare module "fastify" {
  interface FastifyRequest {
    // Set from the session cookie on every request; the only source of "who is asking".
    user: AuthUser | null;
  }
}

export async function requireAuth(req: FastifyRequest) {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in");
}

export function requireRole(role: AuthUser["role"]) {
  return async (req: FastifyRequest) => {
    await requireAuth(req);
    if (req.user?.role !== role) throw new HttpError(403, "FORBIDDEN", "Not available for your account type");
  };
}
