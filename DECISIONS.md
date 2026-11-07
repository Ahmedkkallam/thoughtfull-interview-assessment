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
- **D5 Storage.** Every moment (session start and end, reminder due time) is stored as UTC `timestamptz` and exchanged as ISO-8601 UTC. Working hours are stored as local wall-clock times ("Mon 09:00–17:00") plus the professional's IANA zone (`Europe/London`), never as an offset: an offset is wrong for half the year.
- **D6 Slot generation** (`packages/domain/src/slots.ts`) walks the professional's local calendar days and builds each candidate time with Luxon in their zone, so "09:00 London" becomes 09:00Z in winter and 08:00Z in summer automatically.
  - **Clocks go forward** (a local time does not exist, e.g. 02:00 in New York on 2027-03-14): that slot is skipped, not moved to 03:00, because moving it could collide with the real 03:00 slot.
  - **Clocks go back** (a local time happens twice, e.g. 01:00 in New York on 2026-11-01): it is offered once, at its second occurrence (standard time, 06:00Z), which is what Luxon resolves to. A test pins this, so a library change would be caught.
  - Session length is 50 **absolute** minutes, even across a change.
- **D7 Display.** Slots and sessions are shown in the viewer's **account** timezone (chosen at sign-up), not the browser's, and the zone is named on screen. Slots are grouped by the viewer's local date: a London Monday 16:00 slot appears on Tuesday 00:00 for a member in Singapore.
- **D8 Rules count real hours.** The 24-hour rule and both reminders use absolute time: "24 hours before" a Sunday 10:00 BST session on the day the clocks go forward is Saturday 09:00 UTC, not "the same wall-clock time yesterday".

## Slot layout
- **D9** Sessions start on the hour from the start of each working range and last 50 minutes, leaving a 10-minute buffer before the next. A range that does not fit a whole session at the end drops that partial slot (09:00–17:30 offers 09:00…16:00). Back-to-back 50-minute slots were rejected: start times drift (09:50, 10:40, …) and leave the professional no break.
- **D10** The booking window is `[now, now + 28 days)` in absolute time, using the server clock. It is the same for every viewer, whatever their timezone.
- **D11** A professional may have several ranges per day (a lunch break), but a range cannot cross midnight. This keeps each range on one local date, so DST handling stays per day. Overlapping ranges on the same day are rejected.

## The 24-hour rule
- **D12** "Up to 24 hours before" is inclusive: exactly 24 h before the start is allowed, 1 ms later is blocked. It is checked on the server with the server clock, never in the browser.

## Sign-in and identity
- **D13 Server-side sessions, not JWT.** Login sets a random 32-byte token in an httpOnly, SameSite=Lax cookie (Secure in production) that expires after 7 days. Only its sha256 is stored, so a copy of the table cannot be replayed. Logout deletes the row, so the token stops working immediately; a stateless JWT would stay valid until it expired.
- **D14 Who is asking** comes only from that cookie, on every request. No route reads a user id from the body, query or URL for identity; zod drops unknown body fields.
- **D15 Passwords** use scrypt (N=2^15, r=8, p=1, 16-byte salt), built into Node, so there is no native build on Windows. The parameters are stored with each hash, so they can be raised later. argon2id is the modern first choice; it needs a native module.
- **D16 Login errors** are the same for an unknown email and a wrong password, and both take the same hashing time, so the login form does not reveal who has an account.
- **D17 Timezones** must be IANA names. Aliases browsers send (Asia/Kolkata) are accepted; raw offsets (+05:00) are refused, because an offset cannot follow daylight saving.

## Assumptions (open questions in the brief)
_To be written._

## Known limitations
_To be written._

## What I would do next with more time
_To be written._

## Running this safely in production for a healthcare product
_To be written._
