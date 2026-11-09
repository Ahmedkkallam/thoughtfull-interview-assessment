# AI usage

## Tools
Claude Code (Anthropic) with Claude Opus and Claude Sonnet. I did not use any other AI tool.

## How I split the work
I set the direction and made the calls; I used Claude to implement them, to debug, and to test.

**What I decided**
- **Start from the traps, not the screens.** Before any code, I had every trap in the brief written down as a rule with a test to prove it: two people booking the same slot at once, one member overlapping across two professionals, the member's account timezone versus the browser's, clock changes, the exact 24-hour boundary, reminders exactly once across a restart, a logout that really logs out, and never showing who booked a slot.
- **The data model and the locking strategy.** I designed these after reading the brief and discussing the options with Claude: database constraints versus application checks for double-booking, an outbox table versus a queue for reminders, and which row locks to take and in what order. The reasoning is in `DECISIONS.md` (D22–D31).
- **The stack.** TypeScript on Node with npm workspaces (npm because it ships with Node, so a reviewer installs nothing extra) and PostgreSQL. An ORM for everyday queries, with plain SQL where correctness lives: the no-overlap constraints and the past-booking trigger. Drizzle came out ahead of plain `pg`, Kysely and Prisma for that split (D2).
- **No queue service and no cache.** I ruled out Kafka/BullMQ and Redis: the reminders table is the queue, written in the same transaction as the booking, and a cache could show a slot that was just taken (D4).
- **Email reminders, honestly scoped.** The brief excludes real email delivery, so I chose a local test inbox: emails are really sent, but only to Mailpit on the machine, with the at-least-once trade-off written down (D32, D33).
- **The product feel.** A calm, modern interface for people seeking support: Tailwind, a week calendar instead of a long list of times, an accordion for working hours, soft motion that switches off for people who ask for reduced motion, and times always named in the viewer's own timezone.
- **How the repository reads.** Small commits with plain messages, and nothing in the repository about tooling.

**What Claude did, under that direction**
- **Implementation.** Most of the code, from my requirements: the API, the shared rules in `packages/domain`, the migrations, the reminder worker and the screens.
- **Testing.** Most of the tests, including the race tests that fire requests behind a barrier against a real Postgres, and the daylight saving cases. For every rule that must never break (double-booking, the 24-hour rule, exactly-once reminders, access control) I required a test that fails when the rule is removed, so a green test proves something.
- **Debugging and review.** Reproducing failures (the deadlocks below), and a security and concurrency review pass over the finished code.
- **Docs.** First drafts of the README, `DECISIONS.md` and this file, edited to match the code.

## How I checked the work
I reviewed every change: I read the diffs, ran lint, typecheck and the tests, and used the app in a browser as a member and as a professional in different timezones. I can explain every line in the repository.

The examples below are the cases where the AI's output was wrong and was corrected rather than accepted.

## Where I corrected, rejected or improved AI output

### 1. Luxon and the repeated hour when clocks go back
- **What the AI produced:** While designing the slot rules, Claude wrote that when clocks go back, Luxon resolves a repeated local time to its first occurrence: 01:00 in New York on 2026-11-01 is 05:00Z.
- **What was wrong:** Luxon picks the second occurrence (standard time), 06:00Z.
- **How it was caught:** When the rule was implemented, the code was run against Luxon directly instead of trusting the note, and the result was different.
- **What I did:** The test in `packages/domain/src/slots.test.ts` asserts the real behaviour (01:00 EST, 06:00Z, offered once), and `DECISIONS.md` (D6) says which occurrence is used. The wrong statement was corrected where it was written.
- **Why:** This is exactly the kind of fact I cannot take on trust. If a library update changes this, the test fails instead of a member silently getting a session an hour off.

### 2. Validating a booking against the free slots
- **What the AI produced:** The first plan said the booking endpoint should check that `startsAt` is one of the professional's free slots (working hours minus existing bookings), then insert.
- **What was wrong:** Two people booking the same slot at the same moment both pass that check, which is the exact gap the database constraints exist to close. Worse, a request that arrives just after the winner commits fails the check with 422 `SLOT_NOT_AVAILABLE` instead of the 409 `SLOT_TAKEN` the constraint gives. Which one you got depended on timing, so the race test was random.
- **How it was caught:** While implementing the plan, Claude pointed out that it would turn some lost races into 422, which would make the race test random.
- **What I did:** Booking only checks that the time is on the professional's slot grid (`findSlot` in `apps/api/src/sessions/routes.ts`), then does a plain insert. The two exclusion constraints in `apps/api/migrations/0004_sessions_guards.sql` decide who wins, and the API maps their error to 409 (D23).
- **Why:** One place decides correctness (the database), and the API gives one answer for a lost race.

### 3. Racing bookings deadlocked
- **What the AI produced:** To save the session and its reminders together, the plan wrapped both inserts in one transaction and added no extra locking.
- **What was wrong:** The race test, with ten simultaneous bookings, failed about one run in six. Postgres reported a deadlock (error 40P01) between inserts racing inside the overlap check, and the API returned a 500.
- **How it was caught:** The flaky race test. A stress test of 20 members booking 10 slots gave 19 errors before the fix.
- **What I did:** Booking, reschedule and the weekly-hours save first lock the involved users' rows in id order (`lockPeople` in `apps/api/src/sessions/writes.ts`). Racing requests now wait for each other, and the exclusion constraints still pick the winner. The same stress test gave 0 errors afterwards (D30).
- **Why:** A deadlock is a lock-ordering bug. Taking locks in one fixed order is the standard cure, and I wanted the cause fixed, not retried.

### 4. Cancel and the reminder worker deadlocked (found by review, not by tests)
- **What the AI produced:** Cancel and reschedule locked the session row with `FOR UPDATE`. All tests passed.
- **What was wrong:** The worker holds a session's reminder rows and then inserts notifications. That insert takes a light foreign-key `KEY SHARE` lock on the session. `FOR UPDATE` blocks that lock, while the cancel waits for the reminder rows the worker holds: a deadlock. No test or earlier review had seen it.
- **How it was caught:** A separate AI review pass of the locking code found it by reading. The first idea for a test was also wrong: pause the worker right after its notification insert. At that point the worker already holds the `KEY SHARE` lock, so the cancel just waits and nothing deadlocks. The test that works holds two other people's user rows in a side transaction so the worker stops right after claiming its reminders, then waits (by polling `pg_stat_activity`) until the worker and then the cancel are blocked, and only then releases. That reproduces the real 40P01 against the old code.
- **What I did:** Cancel and reschedule use `FOR NO KEY UPDATE`, which is enough for a status change and does not block foreign-key checks (D31). The test is in `apps/api/test/cancel-reschedule.int.test.ts` and fails on the old code.
- **Why:** A test that cannot fail proves nothing, so the test needed to reproduce the actual interleaving, not a plausible-looking one.

### 5. An Origin check that passed every test and broke the real app
- **What the AI produced:** As an extra guard against cross-site requests, Claude added a check that a write's `Origin` header matches the `Host` header (`apps/api/src/app.ts`). All 209 tests passed.
- **What was wrong:** In the real browser every login and booking returned 403. The tests call the app directly and send no `Origin` header, so they never hit the check. Behind the Vite dev proxy, the shorthand proxy setting rewrites `Host` to the API's own address, so the two never matched.
- **How it was caught:** Only by walking the real app in a browser.
- **What I did:** Set `changeOrigin: false` in `apps/web/vite.config.ts` so the browser's `Host` is kept, with a comment explaining why. There are tests for the matching, mismatching, opaque and missing `Origin` cases in `apps/api/test/auth.int.test.ts`.
- **Why:** Green tests only tell you about what they exercise. A check that depends on headers needs a test through the real path, and the browser walk-through stays part of my process.

### 6. A timezone allow-list that refused Asia/Kolkata
- **What the AI produced:** The brief for timezone validation said the name must be in `Intl.supportedValuesOf("timeZone")` plus `UTC`.
- **What was wrong:** Node's list uses older names (`Asia/Calcutta`, `Europe/Kiev`) and does not contain `Asia/Kolkata`, which is what browsers report. I confirmed this in Node 24. An Indian member signing up from a browser's own timezone would be refused.
- **How it was caught:** By checking the list against the names browsers report, before real users hit it.
- **What I did:** `apps/api/src/auth/timezone.ts` lets `Intl` resolve the name first and then checks the resolved name against the list. Aliases pass; raw offsets such as `+05:00` still fail, because an offset cannot follow daylight saving (D17).
- **Why:** The rule I care about is "real IANA zones only, no offsets". The first version enforced it too bluntly and turned away real users.

### 7. A `PORT` variable that sent the API to the wrong port
- **What the AI produced:** The first setup had the API read the common `PORT` variable.
- **What was wrong:** The preview tool I run the web app with exports `PORT` (it set 5173, the web port), so the API started listening on the web port and every `/api` call returned 502. `--env-file` does not override variables that already exist, so setting it in `.env` did nothing.
- **How it was caught:** Running the app locally: every `/api` call returned 502.
- **What I did:** Renamed it `API_PORT` (`apps/api/src/server.ts`, `.env.example`), with a comment that says why.
- **Why:** A generic variable name is shared with every other tool in the shell. A specific name cannot be hijacked.

### 8. Test dates that were not in the live window
- **What the AI produced:** In the plan for the daylight saving tests, Claude labelled two dates (New York 2026-11-01, London 2026-10-25) as inside the live four-week window. It also planned database tests with a pinned app clock.
- **What was wrong:** Both dates had already passed when the work was done (8 November 2026). And a pinned clock in the past clashes with the database trigger that rejects a start in the past using the database's own clock, so otherwise valid test bookings would be refused.
- **How it was caught:** Checking the dates against the calendar, and noticing that the trigger uses the database's own clock.
- **What I did:** The daylight saving cases stay as pinned-clock tests of the pure domain functions, and the database tests use dates relative to the real current time. I also state in `DECISIONS.md` that a live demo cannot show a clock change until March 2027.
- **Why:** The tests should be honest about what they prove, and the documentation should not claim a demo I cannot show.

### 9. Wrong claim that row locks must be raw SQL
- **What the AI produced:** Claude told me that `FOR UPDATE` and `SKIP LOCKED` would have to be written as raw SQL even with an ORM.
- **What was wrong:** Drizzle's query builder supports both (`.for("update", { of, skipLocked })`, used in `apps/api/src/reminders/deliver.ts`).
- **How it was caught:** Checking that Drizzle's query builder supports both, before the design was settled.
- **What I did:** Locks use the query builder, so rows stay typed. Only the constraints and the trigger are hand-written SQL, because no ORM can express them (D2).
- **Why:** Less raw SQL means fewer untyped results, and the claim that I had to leave the ORM was simply untrue.
