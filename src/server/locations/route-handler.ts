// GET /api/locations/search (#47): the only way the browser reaches place search. Owner-only (the
// same guard as every data entry point), rate limited per session, and it never logs a query or place.

import type { Allowlist } from "@/server/auth/allowlist";
import { AuthFailure, withOwner } from "@/server/auth/guard";
import type { AuthProvider } from "@/server/auth/types";
import type { RateLimiter } from "./rate-limit";
import { handleSearch, type SearchResponse } from "./search-handler";
import type { SearchFn } from "./provider-config";

export interface SearchRouteDeps {
  getAuth: () => Promise<{ provider: AuthProvider; allowlist: Allowlist }>;
  search: SearchFn;
  limiter: RateLimiter;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function toResponse(result: SearchResponse): Response {
  if (result.status === 429)
    return json(result.body, 429, { "retry-after": String(result.retryAfterSeconds) });
  return json(result.body, result.status);
}

export function createSearchRoute({ getAuth, search, limiter }: SearchRouteDeps) {
  const guarded = withOwner(getAuth, (session, request: Request) =>
    handleSearch(
      new URL(request.url).searchParams.get("q"),
      session.userId,
      { search, limiter },
      request.signal,
    ),
  );

  return async function GET(request: Request): Promise<Response> {
    try {
      return toResponse(await guarded(request));
    } catch (error) {
      // Generic bodies only: no email, no hints, no provider detail.
      if (error instanceof AuthFailure) {
        return json(
          { error: error.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden" },
          error.httpStatus,
        );
      }
      return json({ error: "unavailable" }, 500);
    }
  };
}
