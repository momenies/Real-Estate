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

/**
 * Meta's customer-service window. Free-form messages - text, images, the
 * property card - are only accepted within 24 hours of the customer's last
 * inbound message; past it Meta rejects the send with error 131047 and only an
 * approved template gets through.
 */
export const SERVICE_WINDOW_HOURS = 24;

/**
 * A recipient can sit in the broadcast queue for minutes between this check and
 * the actual send, and a send that lands a second past the boundary is rejected
 * outright. The margin buys that slack: a lead close to the edge is reached by
 * template instead, which always works.
 */
export function isWithinServiceWindow(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
  marginMinutes = 30,
): boolean {
  if (!lastInboundAt) return false;
  return hoursSince(lastInboundAt, now) < SERVICE_WINDOW_HOURS - marginMinutes / 60;
}
