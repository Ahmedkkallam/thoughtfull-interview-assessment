import { describe, expect, it } from "vitest";
import { DEFAULT_N, hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password hashing cost", () => {
  it("production default is 2^15", () => {
    expect(DEFAULT_N).toBe(32768);
  });

  it("hashes verify and wrong passwords are rejected", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
