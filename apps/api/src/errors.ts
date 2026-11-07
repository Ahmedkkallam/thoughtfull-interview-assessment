import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, prettifyError } from "zod";

// An error we mean to show the client: status + stable code + message.
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Database constraint violations the client can act on, keyed by "<pg code>:<constraint name>".
const constraintErrors: Record<string, [number, string, string]> = {
  "23505:users_email_key": [409, "EMAIL_TAKEN", "An account with this email already exists"],
  "23P01:sessions_no_professional_overlap": [409, "SLOT_TAKEN", "This time is no longer available"],
  "23P01:sessions_no_member_overlap": [409, "MEMBER_OVERLAP", "You already have a session at this time"],
  "23514:sessions_not_in_past": [422, "PAST_SLOT", "This time has already passed"],
};

// Drizzle wraps the pg error in `cause`, so walk the chain until one matches.
export function mapPgError(err: unknown): HttpError | null {
  for (let e = err; e instanceof Error; e = e.cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    const known = constraintErrors[`${String(code)}:${String(constraint)}`];
    if (known) return new HttpError(...known);
  }
  return null;
}

export function errorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: prettifyError(err) } });
  }
  const known = err instanceof HttpError ? err : mapPgError(err);
  if (known) {
    return reply.status(known.statusCode).send({ error: { code: known.code, message: known.message } });
  }
  // Fastify's own client errors (malformed JSON, wrong content type) carry a 4xx status.
  if (err.statusCode && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ error: { code: err.code ?? "BAD_REQUEST", message: err.message } });
  }
  // Anything else is our bug: log it, but never send internals (SQL, stack) to the client.
  req.log.error(err);
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
