import { DateTime, IANAZone } from "luxon";

/**
 * Groups sorted slots by the viewer's local date, so a London Monday 16:00 slot lands on Tuesday for a Singapore member.
 */
export function groupSlotsByLocalDay<T extends { startsAt: Date }>(
  slots: T[],
  viewerZone: string,
): { day: string; slots: T[] }[] {
  if (!IANAZone.isValidZone(viewerZone)) throw new Error(`Unknown timezone: ${viewerZone}`);

  const groups: { day: string; slots: T[] }[] = [];
  for (const slot of slots) {
    const day = DateTime.fromJSDate(slot.startsAt, { zone: viewerZone }).toISODate()!;
    const last = groups.at(-1);
    if (last?.day === day) last.slots.push(slot);
    else groups.push({ day, slots: [slot] });
  }
  return groups;
}
