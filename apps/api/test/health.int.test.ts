import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { systemClock } from "../src/clock.ts";
import { createTestPool } from "./db.ts";

const pool = createTestPool();
const app = buildApp({ pool, clock: systemClock });

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("GET /api/health", () => {
  it("answers ok when the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
