import { describe, expect, it } from "vitest";
import { SESSION_MINUTES } from "./index.ts";

describe("domain constants", () => {
  it("a session lasts 50 minutes", () => {
    expect(SESSION_MINUTES).toBe(50);
  });
});
