import type { Allowlist } from "@/server/auth/allowlist";
import { AuthFailure, withOwner } from "@/server/auth/guard";
import type { AuthProvider } from "@/server/auth/types";
import type { RateLimiter } from "@/server/locations/rate-limit";
import type { WeatherProvider } from "./provider";
import { handleWeatherRequest, type StopsSource, type WeatherResponse } from "./request-handler";

export interface WeatherRouteDeps {
  getAuth: () => Promise<{ provider: AuthProvider; allowlist: Allowlist }>;
  source: StopsSource;
  provider: WeatherProvider;
  limiter: RateLimiter;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function toResponse(result: WeatherResponse): Response {
  if (result.status === 429)
    return json(result.body, 429, { "retry-after": String(result.retryAfterSeconds) });
  return json(result.body, result.status);
}

export function createWeatherRoute({ getAuth, source, provider, limiter }: WeatherRouteDeps) {
  const guarded = withOwner(getAuth, (session, request: Request) =>
    handleWeatherRequest(
      new URL(request.url).searchParams.get("tripId"),
      session.userId,
      { source, provider, limiter },
      request.signal,
      new URL(request.url).searchParams.get("today"),
    ),
  );

  return async function GET(request: Request): Promise<Response> {
    try {
      return toResponse(await guarded(request));
    } catch (error) {
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
