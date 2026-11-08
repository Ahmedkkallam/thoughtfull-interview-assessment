import { describe, expect, it } from "vitest";
import { DEFAULT_N, hashPassword, parseScryptN, verifyPassword } from "../src/auth/password.ts";

describe("SCRYPT_N validation", () => {
  it("defaults when unset and accepts powers of 2 in range", () => {
    expect(parseScryptN(undefined)).toBe(DEFAULT_N);
    expect(parseScryptN("1024")).toBe(1024);
    expect(parseScryptN("1048576")).toBe(1048576);
  });

  it.each(["abc", "1000", "512", "2097152", "0", "-1024", "1024.5"])("rejects %j", (value) => {
    expect(() => parseScryptN(value)).toThrow(/SCRYPT_N must be a power of 2/);
  });
});

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
