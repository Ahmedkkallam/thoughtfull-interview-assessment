import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.ts";
import { createTestPool } from "./db.ts";

const pool = createTestPool();
const db = createDb(pool);

afterAll(() => pool.end());

describe("database setup", () => {
  it("has the btree_gist extension installed by the migrations", async () => {
    const { rows } = await pool.query("select 1 from pg_extension where extname = 'btree_gist'");
    expect(rows).toHaveLength(1);
  });

  it("returns a timestamptz as the same instant through Drizzle and through pg", async () => {
    const instant = new Date("2027-03-28T00:30:00.000Z");
    const viaPg = await pool.query("select $1::timestamptz as t", [instant]);
    expect((viaPg.rows[0].t as Date).toISOString()).toBe(instant.toISOString());

    const viaDrizzle = await db.execute<{ t: Date }>(sql`select ${instant.toISOString()}::timestamptz as t`);
    expect(new Date(viaDrizzle.rows[0]!.t).toISOString()).toBe(instant.toISOString());
  });
});
