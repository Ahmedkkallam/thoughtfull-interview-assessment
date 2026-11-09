import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
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
    // On by default: reminders are emailed as well as shown in the app; the user can turn it off.
    emailReminders: boolean("email_reminders").notNull().default(true),
    // Professionals only: how far ahead a session must be booked. 0 = up to the start of a slot.
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // On lower(email) so "Ana@x.io" and "ana@x.io" are the same account.
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in ('member', 'professional')`),
    check("users_min_notice_minutes_check", sql`${t.minNoticeMinutes} in (0, 60, 120, 240, 720, 1440, 2880)`),
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

// Time off: whole local days (in the professional's zone) with no slots. Existing sessions are kept.
export const blockedDates = pgTable(
  "blocked_dates",
  {
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A local calendar date, not an instant: "the 11th in London" whatever the viewer's zone.
    day: date("day", { mode: "string" }).notNull(),
    // Private to the professional; members never see it.
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per day: blocking the same day twice is a 409.
    primaryKey({ name: "blocked_dates_pkey", columns: [t.professionalId, t.day] }),
    check("blocked_dates_reason_length", sql`char_length(${t.reason}) <= 80`),
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

// The outbox: written in the booking's transaction, delivered later by the worker (src/worker.ts).
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["24h", "1h"] }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Set when the session is cancelled or moved, so the worker skips it.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    check("reminders_kind_check", sql`${t.kind} in ('24h', '1h')`),
    unique("reminders_session_recipient_kind_key").on(t.sessionId, t.recipientId, t.kind),
    // Small and fast to scan: only reminders still waiting to be sent.
    index("reminders_pending").on(t.dueAt).where(sql`${t.deliveredAt} is null and ${t.cancelledAt} is null`),
  ],
);

// The in-app list. Stores the session and kind, not text, so the app shows times in the reader's zone.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    kind: text("kind", {
      enum: ["reminder_24h", "reminder_1h", "session_cancelled", "session_rescheduled"],
    }).notNull(),
    // UNIQUE: a second guard so one reminder can never become two notifications.
    reminderId: uuid("reminder_id")
      .unique("notifications_reminder_id_key")
      .references(() => reminders.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "notifications_kind_check",
      sql`${t.kind} in ('reminder_24h', 'reminder_1h', 'session_cancelled', 'session_rescheduled')`,
    ),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

// Emails waiting to go out (src/email/send.ts). Queued in the same transaction as the in-app
// reminder, so a reminder is never shown without its email being queued, or the reverse.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // UNIQUE: one notification is emailed at most once.
    notificationId: uuid("notification_id")
      .notNull()
      .unique("email_outbox_notification_id_key")
      .references(() => notifications.id),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    // Null for rows queued before HTML emails existed; those go out as plain text only.
    html: text("html"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Only unsent emails are ever looked up by the sender.
  (t) => [index("email_outbox_unsent").on(t.nextAttemptAt).where(sql`${t.sentAt} is null`)],
);
