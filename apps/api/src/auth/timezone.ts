// Node's list uses older canonical names (Asia/Calcutta, Europe/Kiev) and omits "UTC",
// while browsers report Asia/Kolkata or Europe/Kyiv. So we let Intl resolve the name
// first, then require the resolved name to be on the list: aliases pass, and
// offset strings like "+05:00" (which Intl also accepts) do not.
const namedZones = new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);

// "europe/london" passes Intl; store "Europe/London". Only a difference in letter case is fixed, and only
// for names on Node's list; other accepted names (aliases such as Asia/Kolkata) are stored as given.
const byLowerCase = new Map([...namedZones].map((z) => [z.toLowerCase(), z]));

export function canonicalTimeZone(name: string): string {
  return byLowerCase.get(name.toLowerCase()) ?? name;
}

export function isValidTimeZone(name: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
    return namedZones.has(resolved);
  } catch {
    return false;
  }
}
