import { fileURLToPath } from "node:url";
import { localDay, type WorkingHours } from "@thoughtfull/domain";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { hashPassword } from "./auth/password.ts";
import { replaceWorkingHours } from "./availability/routes.ts";
import { createDb, type Db } from "./db/client.ts";
import { blockedDates, users } from "./db/schema.ts";
import { upcomingBlockedDays } from "./time-off/routes.ts";

const range = (days: number[], start: string, end: string): WorkingHours[] =>
  days.map((weekday) => ({ weekday, start, end }));

// All fictional. Sessions are not seeded: bookings must go through the API so every rule applies.
const people = [
  {
    role: "professional" as const,
    name: "Dr. Mira Okafor",
    email: "mira.okafor@example.test",
    timezone: "Europe/London",
    // Monday to Friday 09:00-17:00 with a lunch break.
    hours: [1, 2, 3, 4, 5].flatMap((d) => [...range([d], "09:00", "12:00"), ...range([d], "13:00", "17:00")]),
  },
  {
    role: "professional" as const,
    name: "Dr. Tomas Reyes",
    email: "tomas.reyes@example.test",
    timezone: "America/New_York",
    hours: range([1, 2, 3, 4], "10:00", "18:00"),
  },
  {
    role: "professional" as const,
    name: "Aiko Tanaka, counsellor",
    email: "aiko.tanaka@example.test",
    timezone: "Asia/Singapore",
    hours: range([2, 3, 4, 5, 6], "08:00", "14:00"),
  },
  { role: "member" as const, name: "Lina Tan", email: "lina.tan@example.test", timezone: "Asia/Singapore", hours: [] },
  { role: "member" as const, name: "Sam Carter", email: "sam.carter@example.test", timezone: "Europe/London", hours: [] },
];

const DAY_MS = 24 * 3600_000;

export async function seed(db: Db, password: string, now = new Date()): Promise<void> {
  const passwordHash = await hashPassword(password);
  for (const p of people) {
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${p.email}`);
    if (existing) continue; // idempotent: running twice changes nothing
    const [row] = await db
      .insert(users)
      // Demo professionals ask for 2 hours' notice (the brief's example); they can change it in Settings.
      .values({ role: p.role, name: p.name, email: p.email, passwordHash, timezone: p.timezone, minNoticeMinutes: p.role === "professional" ? 120 : 0 })
      .returning({ id: users.id });
    if (p.hours.length > 0) await replaceWorkingHours(db, row!.id, p.hours);
  }

  // Dr. Mira Okafor takes a training day about three weeks ahead, unless she already has time off coming up.
  const [mira] = await db.select({ id: users.id }).from(users).where(eq(users.email, "mira.okafor@example.test"));
  const zone = "Europe/London";
  if ((await upcomingBlockedDays(db, mira!.id, localDay(now, zone))).length === 0) {
    // Calendar-date arithmetic on a UTC date: no clock changes in UTC, so +24 h is always the next date.
    let date = new Date(`${localDay(new Date(now.getTime() + 21 * DAY_MS), zone)}T00:00:00Z`);
    // A weekday, so the gap shows in her Monday-to-Friday hours.
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = new Date(date.getTime() + DAY_MS);
    const day = date.toISOString().slice(0, 10);
    await db.insert(blockedDates).values({ professionalId: mira!.id, day, reason: "Training day" });
  }
}

// Run as a script: `npm run seed`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const password = process.env.SEED_PASSWORD || "demo-password-123";
  const pool = new pg.Pool({ connectionString: url });
  try {
    await seed(createDb(pool), password);
    console.log("seed done. Demo logins (same password for all):");
    for (const p of people) console.log(`  ${p.role.padEnd(12)} ${p.email}  (${p.name}, ${p.timezone})`);
    console.log(`  password: ${password}`);
  } finally {
    await pool.end();
  }
}
