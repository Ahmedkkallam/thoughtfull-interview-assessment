const HOUR_MS = 60 * 60 * 1000;

export type ReminderKind = "24h" | "1h";

export interface PlannedReminder {
  recipientId: string;
  kind: ReminderKind;
  dueAt: Date;
}

const OFFSETS: { kind: ReminderKind; ms: number }[] = [
  { kind: "24h", ms: 24 * HOUR_MS },
  { kind: "1h", ms: HOUR_MS },
];

/**
 * The reminders to store for a session: both people get a 24 h and a 1 h reminder (absolute hours).
 * A reminder whose time has already come is not created: booking 23 h ahead gives only the 1 h ones.
 */
export function reminderSchedule({
  startsAt,
  memberId,
  professionalId,
  now,
}: {
  startsAt: Date;
  memberId: string;
  professionalId: string;
  now: Date;
}): PlannedReminder[] {
  const reminders: PlannedReminder[] = [];
  for (const { kind, ms } of OFFSETS) {
    const dueAt = startsAt.getTime() - ms;
    if (dueAt <= now.getTime()) continue;
    for (const recipientId of [memberId, professionalId]) {
      reminders.push({ recipientId, kind, dueAt: new Date(dueAt) });
    }
  }
  return reminders;
}
