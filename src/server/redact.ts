// Log redaction (#22, from the privacy rules in #28). The app's own loggers (auth, data, locations) can only emit a closed
// set of event codes, so nothing sensitive reaches them by construction. This module covers the rest: anything that
// logs free text or structured fields goes through `logWarning` / `logInfo`, which scrub what must never be logged:
// emails, dates, credentials in URLs, and the values of sensitive fields (destinations, item names, trip data).

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 2026-10-23, 2026-10-23T12:00:00Z, 10/23/2026, 23.10.2026
const ISO_DATE =
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const SLASH_DATE = /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g;
const MONTH_DATE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?\b/g;
// scheme://user:password@host -> the credentials and host go
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

export const REDACTED = "[redacted]";

export function redact(text: string): string {
  return text
    .replace(URL_CREDENTIALS, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(ISO_DATE, REDACTED)
    .replace(SLASH_DATE, REDACTED)
    .replace(MONTH_DATE, REDACTED);
}

/** Fields whose VALUES are never logged, whatever they contain. */
/** Field names whose values are never logged (#22): trip, place, list and stamp text, and credentials. */
export const SENSITIVE_KEYS = new Set([
  "email",
  "password",
  "token",
  "secret",
  "destination",
  "location",
  "place",
  "query",
  "name",
  "items",
  "item",
  "label",
  "city",
  "start",
  "end",
  "date",
  "latitude",
  "longitude",
  "trip",
  "trips",
  "staple",
  "staples",
  "names",
  "labels",
  "destinations",
  "stop",
  "stops",
  "list",
  "lists",
  "stamp",
  "category",
  "categories",
  "title",
  "note",
  "notes",
  "address",
  "country",
  "region",
]);

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED
        : typeof value === "string"
          ? redact(value)
          : value !== null && typeof value === "object"
            ? REDACTED
            : value,
    ]),
  );
}

export type LogSink = (line: string) => void;

let sink: LogSink | undefined;

/** Test hook: capture lines instead of writing to the console. Pass nothing to restore. */
export function setLogSink(next?: LogSink): void {
  sink = next;
}

function emit(level: "info" | "warn", message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    message: redact(message),
    ...(fields ? { fields: redactFields(fields) } : {}),
  });
  if (sink) sink(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logInfo = (message: string, fields?: Record<string, unknown>) =>
  emit("info", message, fields);
export const logWarning = (message: string, fields?: Record<string, unknown>) =>
  emit("warn", message, fields);
