import { describe, expect, it } from "vitest";
import { reminderSchedule } from "./reminders.ts";

const now = new Date("2027-01-10T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const inMs = (ms: number) => new Date(now.getTime() + ms);
const plan = (startsAt: Date, at = now) =>
  reminderSchedule({ startsAt, memberId: "member-1", professionalId: "pro-1", now: at }).map((r) => ({
    ...r,
    dueAt: r.dueAt.toISOString(),
  }));

describe("reminder schedule", () => {
  it("a session 25 hours ahead gets four reminders: 24 h and 1 h for both people", () => {
    expect(plan(inMs(25 * HOUR_MS))).toEqual([
      { recipientId: "member-1", kind: "24h", dueAt: "2027-01-10T11:00:00.000Z" },
      { recipientId: "pro-1", kind: "24h", dueAt: "2027-01-10T11:00:00.000Z" },
      { recipientId: "member-1", kind: "1h", dueAt: "2027-01-11T10:00:00.000Z" },
      { recipientId: "pro-1", kind: "1h", dueAt: "2027-01-11T10:00:00.000Z" },
    ]);
  });

  it("a session 23 hours ahead gets only the 1 h reminders, the 24 h time has passed", () => {
    expect(plan(inMs(23 * HOUR_MS)).map((r) => [r.recipientId, r.kind])).toEqual([
      ["member-1", "1h"],
      ["pro-1", "1h"],
    ]);
  });

  it("a session 50 minutes ahead gets no reminders", () => {
    expect(plan(inMs(50 * 60 * 1000))).toEqual([]);
  });

  it("a reminder due exactly now is not created", () => {
    expect(plan(inMs(24 * HOUR_MS)).map((r) => r.kind)).toEqual(["1h", "1h"]);
    expect(plan(inMs(HOUR_MS))).toEqual([]);
  });

  it("counts real hours across a DST change", () => {
    // 10:00 BST on 2027-03-28 (09:00Z); London changed clocks the night before.
    const reminders = plan(new Date("2027-03-28T09:00:00Z"), new Date("2027-03-20T00:00:00Z"));
    expect(reminders.map((r) => [r.kind, r.dueAt])).toEqual([
      ["24h", "2027-03-27T09:00:00.000Z"],
      ["24h", "2027-03-27T09:00:00.000Z"],
      ["1h", "2027-03-28T08:00:00.000Z"],
      ["1h", "2027-03-28T08:00:00.000Z"],
    ]);
  });
});
