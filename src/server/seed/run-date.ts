// Which calendar date the e2e sample trips are seeded relative to (#278). The sample trips are relative to a "today"
// (sample-data.ts: San Diego starts 7 days after it, Lisbon ended 39 days before it), so for a browser test to see San Diego as
// upcoming, the seed's today must be the date the BROWSER believes it is. Two kinds of test exist: those that pin the browser's
// clock to the prototype's date (SAMPLE_TODAY) and those that run on the real clock. Seeding from the clock the page actually has
// serves both, and means a calendar date passing can never turn San Diego into a past trip.

/** YYYY-MM-DD from a whole year, month (1-12) and day. */
export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The UTC calendar date of an instant (the real run date when given the real time). */
export function utcDate(ms: number = Date.now()): string {
  const date = new Date(ms);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
