import { describe, expect, it } from "vitest";
import { canMemberChange } from "./rules.ts";

const startsAt = new Date("2027-01-10T10:00:00Z");
const before = (ms: number) => new Date(startsAt.getTime() - ms);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("a member may change a session up to 24 hours before it starts", () => {
  it("allows a change 24 hours and 1 ms before the start", () => {
    expect(canMemberChange(startsAt, before(DAY_MS + 1))).toBe(true);
  });

  it("allows a change exactly 24 hours before the start", () => {
    expect(canMemberChange(startsAt, before(DAY_MS))).toBe(true);
  });

  it("blocks a change 1 ms inside the 24 hours", () => {
    expect(canMemberChange(startsAt, before(DAY_MS - 1))).toBe(false);
  });

  it("counts real hours across a DST change, not wall-clock hours", () => {
    // 10:00 BST on 2027-03-28 is 09:00Z; London moved to BST that night, so 24 real hours earlier is 09:00 GMT.
    const dstStart = new Date("2027-03-28T09:00:00Z");
    expect(canMemberChange(dstStart, new Date("2027-03-27T09:00:00Z"))).toBe(true);
    // 10:00 GMT the day before is the same wall-clock time but only 23 real hours ahead.
    expect(canMemberChange(dstStart, new Date("2027-03-27T10:00:00Z"))).toBe(false);
  });
});
