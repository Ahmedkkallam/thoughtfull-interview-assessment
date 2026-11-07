import { sql } from "drizzle-orm";
import { check, customType, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
