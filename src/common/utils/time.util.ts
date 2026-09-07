/**
 * Everything the platform schedules - quiet hours, daily caps, trial expiry -
 * is judged in the office's own timezone, not the server's.
 */
export function officeNowParts(timezone: string, at: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number.parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
    minute: Number.parseInt(parts.minute, 10),
  };
}

/** Local calendar day (YYYY-MM-DD) used as the daily-quota bucket key. */
export function officeDayKey(timezone: string, at: Date = new Date()): string {
  return officeNowParts(timezone, at).day;
}

/**
 * Quiet hours may wrap past midnight (22 -> 8), so the comparison differs
 * depending on whether the window crosses the day boundary.
 */
export function isWithinQuietHours(
  timezone: string,
  quietStart: number,
  quietEnd: number,
  at: Date = new Date(),
): boolean {
  if (quietStart === quietEnd) return false;
  const { hour } = officeNowParts(timezone, at);
  return quietStart < quietEnd
    ? hour >= quietStart && hour < quietEnd
    : hour >= quietStart || hour < quietEnd;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function hoursSince(date: Date | null | undefined, now: Date = new Date()): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / 3_600_000;
}
