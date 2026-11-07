const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A member may cancel or reschedule up to 24 hours before the start.
 * Exactly 24 h before is still allowed ("up to" is inclusive). Hours are absolute, so a DST change does not shift the cut-off.
 */
export function canMemberChange(startsAt: Date, now: Date): boolean {
  return now.getTime() <= startsAt.getTime() - DAY_MS;
}
