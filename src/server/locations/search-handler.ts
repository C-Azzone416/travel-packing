// The request logic behind /api/locations/search (#47), kept free of Next so it can be tested directly.
// The route wraps it in the owner guard. Logging is a closed set of event codes: no query, place,
// session id or error message can be passed in, by construction.

import type { SampleLocation } from "@/domain/trip-lifecycle";
import type { RateLimiter } from "./rate-limit";

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 50;

export type LocationEvent = "search" | "invalid-query" | "rate-limited" | "provider-error";
export type LocationLogSink = (line: string) => void;

const defaultSink: LocationLogSink = (line) => console.info(line);
let sink: LocationLogSink = defaultSink;

/** Test hook: capture log lines. Pass nothing to restore the default. */
export function setLocationLogSink(next?: LocationLogSink): void {
  sink = next ?? defaultSink;
}

export function logLocationEvent(event: LocationEvent): void {
  sink(JSON.stringify({ scope: "locations", event }));
}

export type SearchResponse =
  | { status: 200; body: { places: SampleLocation[] } }
  | { status: 400; body: { error: "invalid-query" } }
  | { status: 429; body: { error: "rate-limited" }; retryAfterSeconds: number }
  | { status: 502; body: { error: "unavailable" } };

export interface SearchDeps {
  search: (query: string, options: { signal?: AbortSignal }) => Promise<SampleLocation[]>;
  limiter: RateLimiter;
}

export async function handleSearch(
  rawQuery: string | null,
  sessionKey: string,
  { search, limiter }: SearchDeps,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const query = (rawQuery ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    logLocationEvent("invalid-query");
    return { status: 400, body: { error: "invalid-query" } };
  }

  const decision = limiter.consume(sessionKey);
  if (!decision.ok) {
    logLocationEvent("rate-limited");
    return {
      status: 429,
      body: { error: "rate-limited" },
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    };
  }

  try {
    const places = await search(query, { signal });
    logLocationEvent("search");
    return { status: 200, body: { places } };
  } catch {
    logLocationEvent("provider-error");
    return { status: 502, body: { error: "unavailable" } };
  }
}
