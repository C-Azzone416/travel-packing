const MS_PER_DAY = 86_400_000;

export type ForecastLabel = "Close forecast" | "Seasonal outlook";

export interface NormalizedDates {
  start: string;
  end: string;
  adjusted: boolean;
  valid: boolean;
}

// Dates are date-only strings (YYYY-MM-DD) read as UTC midnight, so results
// never depend on the machine's timezone or DST (pending #26).
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
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
