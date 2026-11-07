# Decisions

Each decision: what, why, alternatives considered. IDs (D1, D2, …) are cited in code comments and tests where useful.

## Stack
- **D1 Stack.** TypeScript on Node 24 with npm workspaces: `apps/api` (Fastify), `apps/web` (React + Vite), `packages/domain` (pure rules: slots, the 24 h rule, reminder times). PostgreSQL 16. Vitest for every test. npm rather than pnpm because it ships with Node, so a reviewer installs nothing extra.
- **D2 Data access.** Drizzle ORM defines the tables in one schema file and writes everyday queries, so results are typed. The rules that guarantee correctness (the two no-overlap constraints and the no-past-booking trigger) are hand-written SQL in their own migration: no ORM can express them, and Postgres must enforce them. drizzle-kit generates migrations; each is read before it is committed, `push` is never used, and one migrator applies them for the app and the tests. Rejected: plain `pg` (untyped results), Kysely (a query builder whose types are kept by hand), Prisma (cannot model exclusion constraints).
- **D3 Test database.** `npm test` starts a throwaway Postgres (`db-test`, in memory, port 54329) with Docker Compose, recreates the schema, and runs the real migrations before the tests. Testcontainers was rejected: an extra dependency and slower, flakier startup on Windows.
- **D4 No queue service, no cache.** The reminders table is the queue: it is written in the same transaction as the booking, so a booking and its reminders are saved together or not at all. Kafka or BullMQ would split them across two systems, where a crash between the two writes loses or duplicates a reminder. No Redis: the data is small, slots compute in milliseconds, and a cache could show a slot that was just booked.

## How double-booking is prevented
_To be written as the booking code lands._

## How reminders are scheduled and delivered reliably
_To be written as the reminder worker lands._

## Timezones and daylight saving
_To be written as slot generation lands._

## Assumptions (open questions in the brief)
_To be written._

## Known limitations
_To be written._

## What I would do next with more time
_To be written._

## Running this safely in production for a healthcare product
_To be written._
