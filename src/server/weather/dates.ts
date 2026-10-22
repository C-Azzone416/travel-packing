const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(value: string): Date | null {
  if (!DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

export const formatDay = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(value: string, count: number): string | null {
  const date = parseDay(value);
  return date ? formatDay(new Date(date.getTime() + count * DAY_MS)) : null;
}

/** The longest stop the weather code will build days for (about 13 months). Longer is refused, never expanded. */
export const MAX_STOP_SPAN_DAYS = 400;

export function stopDays(arrive: string, leave: string, includeLeave: boolean): string[] | null {
  const first = parseDay(arrive);
  const last = parseDay(leave);
  if (!first || !last || last < first) return null;
  // One array entry per day: an unbounded span from a hand-made request would exhaust memory.
  if ((last.getTime() - first.getTime()) / DAY_MS > MAX_STOP_SPAN_DAYS) return null;
  const end = last.getTime() + (includeLeave ? DAY_MS : 0);
  const days: string[] = [];
  for (let at = first.getTime(); at < end; at += DAY_MS) days.push(formatDay(new Date(at)));
  return days.length > 0 ? days : null;
}

/** Forecast API range: today through the next 15 days, inclusive. */
export function isForecastDay(value: string, today: string): boolean {
  const day = parseDay(value);
  const start = parseDay(today);
  if (!day || !start) return false;
  const distance = (day.getTime() - start.getTime()) / DAY_MS;
  return distance >= 0 && distance < 16;
}

export const monthDay = (value: string): string => value.slice(5);

export function sameCalendarDay(year: number, value: string): string | null {
  const candidate = `${String(year).padStart(4, "0")}-${monthDay(value)}`;
  return parseDay(candidate) ? candidate : null;
}
