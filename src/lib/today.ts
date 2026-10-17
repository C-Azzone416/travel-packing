// The only place the app reads the clock. The domain never does: every date rule
// takes `today` as a parameter. Device-local calendar date, as date-only text
// (design's #26 recommendation; pending PM/Caroline sign-off).
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
