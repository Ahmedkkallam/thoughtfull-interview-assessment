import { sql } from "drizzle-orm";
import {
  check,
  customType,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Drizzle has no built-in bytea column; pg already reads and writes it as a Buffer.
const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: text("role", { enum: ["member", "professional"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    // IANA zone name, validated at sign-up.
    timezone: text("timezone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // On lower(email) so "Ana@x.io" and "ana@x.io" are the same account.
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in ('member', 'professional')`),
  ],
);

export const authSessions = pgTable("auth_sessions", {
  // sha256 of the cookie token: a database leak does not leak live tokens.
  tokenHash: bytea("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ISO weekday (1 = Monday) in the professional's own zone.
    weekday: smallint("weekday").notNull(),
    // Local wall-clock times; overlap between ranges is checked before saving, not here.
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    check("working_hours_weekday_check", sql`${t.weekday} between 1 and 7`),
    check("working_hours_end_after_start", sql`${t.endTime} > ${t.startTime}`),
    unique("working_hours_professional_weekday_start_key").on(t.professionalId, t.weekday, t.startTime),
  ],
);

// The overlap rules (two EXCLUDE constraints) and the past-start trigger are hand-written
// in migrations/0004_sessions_guards.sql, because Drizzle cannot express them.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => users.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => users.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // booked -> cancelled is the only change; a cancelled row stays as history and frees its time.
    status: text("status", { enum: ["booked", "cancelled"] }).notNull().default("booked"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason", { enum: ["member", "professional", "rescheduled"] }),
    // UNIQUE: an old session can be replaced by at most one new one.
    rescheduledFrom: uuid("rescheduled_from")
      .unique("sessions_rescheduled_from_key")
      .references((): AnyPgColumn => sessions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("sessions_status_check", sql`${t.status} in ('booked', 'cancelled')`),
    check("sessions_cancel_reason_check", sql`${t.cancelReason} in ('member', 'professional', 'rescheduled')`),
    check("sessions_fifty_minutes", sql`${t.endsAt} - ${t.startsAt} = interval '50 minutes'`),
    check("sessions_not_self", sql`${t.memberId} <> ${t.professionalId}`),
    // A cancelled session always records when; a booked one never has a cancel time.
    check("sessions_cancelled_at_matches_status", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  ],
);
