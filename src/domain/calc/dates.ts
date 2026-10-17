const MS_PER_DAY = 86_400_000;

export type ForecastLabel = "Close forecast" | "Seasonal outlook";

export interface NormalizedDates {
  start: string;
  end: string;
  adjusted: boolean;
  valid: boolean;
}

// Dates are strict date-only strings (YYYY-MM-DD) read as UTC midnight, so
// results never depend on the machine's timezone or DST (pending #26).
// Anything else, including impossible dates like 2026-02-30, is rejected.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string | null | undefined): Date | null {
  const match = value ? DATE_ONLY.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}

export function tripDays(start: string | null | undefined, end: string | null | undefined): number {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to || to < from) return 0;
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
}

export function packingDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  return Math.max(0, tripDays(start, end) - 2);
}

export function normalizeTripDates(
  start: string | null | undefined,
  end: string | null | undefined,
): NormalizedDates {
  const from = parseDate(start);
  if (!from) return { start: start || "", end: end || "", adjusted: false, valid: false };
  const to = parseDate(end);
  if (!to || to < from)
    return { start: start as string, end: start as string, adjusted: true, valid: true };
  return { start: start as string, end: end as string, adjusted: false, valid: true };
}

// `today` is always passed in: the domain has no hidden clock.
export function forecastLabel(
  start: string | null | undefined,
  today: string | null | undefined,
): ForecastLabel {
  const from = parseDate(start);
  const now = parseDate(today);
  if (!from || !now) return "Seasonal outlook";
  const distance = Math.ceil((from.getTime() - now.getTime()) / MS_PER_DAY);
  return distance >= 0 && distance <= 10 ? "Close forecast" : "Seasonal outlook";
}
