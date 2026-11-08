import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { systemClock } from "./clock.ts";
import { createDb } from "./db/client.ts";
import { deliverDueReminders } from "./reminders/deliver.ts";

// A separate process from the API: running more API copies never runs more pollers by accident,
// and an API crash does not stop reminders.
const POLL_MS = 5000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: databaseUrl });
pool.on("error", (err) => console.error("idle database connection error", err));
const db = createDb(pool);

// On Ctrl+C or a container stop, let the current run commit, then exit.
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.abort());

console.log("reminder worker started");
while (!stop.signal.aborted) {
  try {
    const delivered = await deliverDueReminders(db, systemClock.now());
    if (delivered > 0) console.log(`delivered ${delivered} reminder notification(s)`);
  } catch (err) {
    // The failed batch was rolled back, so its reminders are simply picked up on the next run.
    console.error("reminder delivery failed", err);
  }
  await sleep(POLL_MS, undefined, { signal: stop.signal }).catch(() => {});
}
await pool.end();
console.log("reminder worker stopped");
