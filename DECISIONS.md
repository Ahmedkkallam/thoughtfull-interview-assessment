# Decisions

Each decision: what, why, and the alternative I rejected. The file paths point to the code that implements it.

## Stack
- **D1 Stack.** TypeScript on Node 24 with npm workspaces: `apps/api` (Fastify), `apps/web` (React + Vite), `packages/domain` (pure rules: slots, the 24 h rule, reminder times). PostgreSQL 16. Vitest for every test. npm rather than pnpm because it ships with Node, so a reviewer installs nothing extra.
- **D2 Data access.** Drizzle ORM defines the tables in one schema file and writes everyday queries, so results are typed. The rules that guarantee correctness (the two no-overlap constraints and the no-past-booking trigger) are hand-written SQL in their own migration: no ORM can express them, and Postgres must enforce them. drizzle-kit generates migrations; each is read before it is committed, `push` is never used, and one migrator applies them for the app and the tests. Rejected: plain `pg` (untyped results), Kysely (a query builder whose types are kept by hand), Prisma (cannot model exclusion constraints).
- **D3 Test database.** `npm test` starts a throwaway Postgres (`db-test`, in memory, port 54329) with Docker Compose, recreates the schema, and runs the real migrations before the tests. Testcontainers was rejected: an extra dependency and slower, flakier startup on Windows.
- **D4 No queue service, no cache.** The reminders table is the queue: it is written in the same transaction as the booking, so a booking and its reminders are saved together or not at all. Kafka or BullMQ would split them across two systems, where a crash between the two writes loses or duplicates a reminder. No Redis: the data is small, slots compute in milliseconds, and a cache could show a slot that was just booked.

## How double-booking is prevented
The database is the referee, not the application. Code that first checks "is this slot free?" and then inserts has a gap between the check and the insert, and two requests arriving together both pass the check.
- **D22 Two exclusion constraints** on `sessions` (`apps/api/migrations/0004_sessions_guards.sql`):
  - `sessions_no_professional_overlap`: no two booked sessions of the same professional may overlap in time.
  - `sessions_no_member_overlap`: the same for a member, across all professionals.
  - Each compares `tstzrange(starts_at, ends_at, '[)')` with `&&` (overlap). The `'[)'` range is half-open, so a 10:00–10:50 session and an 11:00 session (or one starting exactly at 10:50) do not conflict.
  - `WHERE (status = 'booked')`: a cancelled session stops counting, which frees the time without deleting history.
  - Postgres checks these through an index and makes a second, concurrent insert wait for the first; when the first commits, the second fails with error 23P01. The API maps that to **409 SLOT_TAKEN** or **409 MEMBER_OVERLAP** by constraint name.
- **D23 The API checks only that the start time is a real slot** of the professional (on the hour grid, inside working hours, in the future, within 28 days), then does a plain insert. It deliberately does **not** pre-check other bookings: under a race that check would be stale anyway, and it would turn some lost races into a confusing 422 instead of 409.
- **D24 No booking in the past**, checked twice: the slot grid uses the server clock, and a `BEFORE INSERT` trigger rejects `starts_at <= now()` using the database's own clock. A trigger rather than a CHECK constraint: a CHECK with `now()` would fail on old rows when a backup is restored.
- **Proof:** `apps/api/test/booking.int.test.ts` sends 10 bookings for the same slot at the same moment (behind a barrier, real Postgres): exactly one 201 and nine 409. One member booking two professionals at the same time gets one 201 and one 409. With either constraint removed, these tests fail.
- **Also enforced by the database:** a session is exactly 50 minutes; a member cannot book themselves; `cancelled_at` is set exactly when the status is `cancelled`.

## How reminders are scheduled and delivered reliably
- **D25 Scheduling (outbox).** A booking writes its reminder rows in the **same transaction** as the session (`apps/api/src/sessions/routes.ts`): 24 h and 1 h before, for both the member and the professional, so up to 4 rows. A reminder whose time has already passed is not created (`reminderSchedule` in `packages/domain`): booking 23 h ahead creates only the two 1 h reminders; booking 50 minutes ahead creates none. "24 hours" is absolute time, so it stays right across a daylight-saving change.
- **D26 Delivery.** A separate worker process (`apps/api/src/worker.ts`) checks every 5 seconds. Each batch is one transaction (`apps/api/src/reminders/deliver.ts`):
  1. Claim due reminders with `SELECT … FOR UPDATE OF reminders SKIP LOCKED`, only for sessions that are still booked and have not started.
  2. Insert one notification per reminder.
  3. Set `delivered_at` on the reminders.
  4. Commit.
- **D27 Why that is exactly once.** Steps 2 and 3 commit together. If the worker dies before the commit, both are undone and the reminder is picked up on the next run; after the commit, it is never selected again. `SKIP LOCKED` lets several workers run without taking the same reminder. A `UNIQUE (reminder_id)` on notifications is a second guard against a bug. Tested: a crash injected between the insert and the commit, then a "restart" on a new connection pool, delivers exactly one notification; two workers racing over 20 due reminders deliver exactly 20.
- **D28 Why not a queue (BullMQ, Kafka) or a timer in the API.** The reminders table is the queue: it lives in the same database as the booking, so there is no gap where a booking is saved but its job is not (or the reverse). A timer inside the API would run once per API copy and stop when the API crashes; the worker is its own process, started by `npm run dev` and by Docker Compose.
- **D29 Late and stale reminders.** If the worker was down, a reminder that is overdue is still delivered once, as long as the session has not started. It is never delivered for a cancelled session or one that has already started.
- **D30 Racing bookings take turns.** With the booking in a transaction, simultaneous bookings could deadlock inside the overlap check, which Postgres reports as an error (a 500). Booking now locks both people's user rows in id order first; racing bookings wait their turn, and the exclusion constraints still decide who wins.
- **D31 Cancel and reschedule lock the session `FOR NO KEY UPDATE`, not `FOR UPDATE`.** The worker, while holding a session's reminder rows, inserts notifications whose foreign key takes a light `KEY SHARE` lock on that session. `FOR UPDATE` blocks that lock while the cancel waits for the same reminder rows: a deadlock. `NO KEY UPDATE` is all a status change needs and does not block foreign-key checks. A test reproduces the exact interleaving.
- **Production:** real email, SMS or push cannot be inside the database transaction, so delivery to a provider becomes at-least-once with an idempotency key (the reminder id) that the provider uses to drop duplicates.

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

## Privacy and access
- **D18 Allow-listed fields.** The professionals list and profile return only id, name and timezone; the columns are listed in one place (`apps/api/src/professionals/routes.ts`), so an email cannot leak by accident.
- **D19 Free slots say nothing about other people.** The slots response is only `{startsAt, endsAt}`. A booked time and a time outside working hours look the same: absent.
- **D20 Not yours = not found.** A malformed id, a member's id, or another person's session returns 404, the same as an id that does not exist, so the API does not confirm what exists.
- **D21 Weekly hours are saved as a whole week** (delete and insert in one transaction), not range by range. Overlap between ranges is checked by the shared domain validation before saving; the database also enforces weekday 1–7 and end after start.

## Assumptions (open questions in the brief)
The brief leaves these open; each answer is what I think is right for the person booking.
- **Slot layout:** on the hour, 50 minutes plus a 10-minute break; a partial slot at the end of a range is dropped (D9).
- **Working hours:** several ranges per day are allowed (a lunch break); a range cannot cross midnight (D11). A night shift would be entered as two ranges on two days.
- **"Next 4 weeks":** `[now, now + 28 days)` in absolute time on the server clock, the same for every viewer (D10).
- **Clock changes:** a local time that does not exist is skipped; a repeated one is offered once (D6). If a viewer sees two slots with the same local time on one day, the zone abbreviation is shown to tell them apart.
- **Exactly 24 hours before:** allowed. "Up to 24 hours" is inclusive (D12).
- **Booking less than 24 h or 1 h ahead:** allowed; reminders whose time has passed are simply not created (D25).
- **Hours changed after bookings:** existing sessions stay as booked; only future free slots change. The professional can still cancel a session that no longer fits.
- **Who can cancel:** members up to 24 hours before; professionals any time before the start; nobody after the start.
- **Professional cancels:** the member gets an in-app notification. Cancelled sessions appear under "Past" with who cancelled. The old row of a reschedule is not shown (its replacement is).
- **Reschedule:** same professional only; a different professional is a cancel plus a new booking. Moving to the time it already has is refused.
- **One role per account:** a person who is both would use two accounts. Nobody can book themselves (database CHECK).
- **Timezone change after sign-up:** not offered in this version. Stored times are UTC, so a change would only change how times are displayed.
- **Professional sign-up:** anyone can register as a professional here. A real product verifies credentials first (out of scope, see production notes).

## Known limitations
_To be written._

## What I would do next with more time
_To be written._

## Running this safely in production for a healthcare product
_To be written._
