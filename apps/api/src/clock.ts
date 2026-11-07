// "Now" is injected so tests can pin time.
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };
