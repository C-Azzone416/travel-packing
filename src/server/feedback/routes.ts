// The HTTP layer for Framebriar enrollment and the report proxy (#259). One prelude guards every route, in this order: the feature
// is switched on for this build, the caller is a signed-in allowlisted owner (the owner id comes from the session and nowhere
// else), a POST comes from the app's own origin, the owner is inside a rate limit, the content type is exact and the body is bounded
// while it is read. Every answer is JSON with `no-store`, carries a closed error code and nothing else: no provider text, no
// credential, no invitation, no owner id, no email. See the contract on #258.

import type { Allowlist } from "../auth/allowlist";
import { authorizeOwner } from "../auth/guard";
import { PREVIEW_ORIGIN } from "../auth/request-origin";
import type { AuthProvider } from "../auth/types";
import { createRateLimiter, type RateLimiter } from "../locations/rate-limit";
import type { EnrollmentError, EnrollmentService } from "./enrollment-service";
import { GAME_ID, type FramebriarClient } from "./framebriar-client";
import { FRAMEBRIAR_SERVER_MARKER } from "./key-ring";
import { parseReportRequest, readBounded, type ReportRefusal } from "./report-proxy";

export { FRAMEBRIAR_SERVER_MARKER };

type Env = Record<string, string | undefined>;

export const LOCAL_ORIGIN = "http://localhost:8080";

export type ErrorCode =
  | EnrollmentError
  | ReportRefusal
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_ORIGIN"
  | "NOT_FOUND"
  | "UPSTREAM";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  BAD_ORIGIN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  ALREADY_CONNECTED: 409,
  NOT_CONNECTED: 409,
  NEEDS_RECONNECT: 409,
  EXPIRED: 409,
  REVOKED: 409,
  DISABLED: 409,
  INVITATION_REJECTED: 422,
  UNCERTAIN: 502,
  UPSTREAM: 502,
  UNAVAILABLE: 503,
};

/**
 * Whether this build carries the feature at all. Production never does: the build also replaces the whole route module with a
 * stub (next.config.ts), and this is the second, runtime lock. It mirrors the client's build gate: stable Preview, local
 * development and the synthetic e2e build.
 */
export function feedbackServerEnabled(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return (
    env.VERCEL_ENV === "preview" ||
    env.NODE_ENV === "development" ||
    env.NEXT_PUBLIC_E2E_BUILD === "1"
  );
}

/** The origins a POST may come from. A different Preview deployment URL is not one of them. */
export function trustedOrigins(request: Request, env: Env = process.env): string[] {
  if (env.VERCEL_ENV === "preview") return [PREVIEW_ORIGIN];
  const own = new URL(request.url).origin;
  if (env.NEXT_PUBLIC_E2E_BUILD === "1") return [own];
  return env.NODE_ENV === "development" ? [LOCAL_ORIGIN] : [];
}

function respond(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { v: 1, ...body },
    { status, headers: { "cache-control": "no-store", ...headers } },
  );
}

export function failure(code: ErrorCode, retryAfterSeconds?: number): Response {
  const retry = retryAfterSeconds !== undefined && retryAfterSeconds > 0;
  return respond(
    { error: code, ...(retry ? { retryAfterSeconds: Math.ceil(retryAfterSeconds) } : {}) },
    STATUS[code],
    retry ? { "retry-after": String(Math.ceil(retryAfterSeconds)) } : {},
  );
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export interface RouteDeps {
  getAuth: () => Promise<{ provider: AuthProvider; allowlist: Allowlist }>;
  /** The enrollment service, or null when the database is not configured. */
  getService: () => Promise<EnrollmentService | null>;
  client: FramebriarClient;
  env?: Env;
  now?: () => number;
  /** Overrides for the per-account request limits. Only the synthetic e2e build passes any (e2e-upstream.ts); real builds use LIMITS. */
  limits?: Partial<Record<Kind, { limit: number; windowMs: number }>>;
}

type Kind = "status" | "redeem" | "disconnect" | "reports";

const LIMITS: Record<Kind, { limit: number; windowMs: number }> = {
  status: { limit: 60, windowMs: 60_000 },
  redeem: { limit: 5, windowMs: 10 * 60_000 },
  disconnect: { limit: 10, windowMs: 10 * 60_000 },
  reports: { limit: 20, windowMs: 10 * 60_000 },
};

const JSON_BODY_BYTES = 1024;
const INVITATION = /^[A-Za-z0-9_-]{16,128}$/;

export function createFeedbackRoutes(deps: RouteDeps) {
  const env = deps.env ?? process.env;
  const limiters = Object.fromEntries(
    (Object.keys(LIMITS) as Kind[]).map((kind) => [
      kind,
      createRateLimiter({ ...LIMITS[kind], ...deps.limits?.[kind], now: deps.now }),
    ]),
  ) as Record<Kind, RateLimiter>;

  type Prelude = { ownerId: string; service: EnrollmentService } | Response;

  async function prelude(request: Request, kind: Kind, post: boolean): Promise<Prelude> {
    if (!feedbackServerEnabled(env)) return failure("NOT_FOUND");
    const { provider, allowlist } = await deps.getAuth();
    const decision = await authorizeOwner(provider, allowlist);
    if (decision.status !== "ok")
      return failure(decision.status === "unauthenticated" ? "UNAUTHENTICATED" : "FORBIDDEN");
    if (post) {
      const origin = request.headers.get("origin");
      if (origin === null || !trustedOrigins(request, env).includes(origin))
        return failure("BAD_ORIGIN");
    }
    const ownerId = decision.session.userId;
    const allowed = limiters[kind].consume(ownerId);
    if (!allowed.ok) return failure("RATE_LIMITED", seconds(allowed.retryAfterMs));
    const service = await deps.getService();
    if (!service) return failure("UNAVAILABLE");
    return { ownerId, service };
  }

  /** The JSON body of a POST: exact content type, bounded read, parsed object. */
  async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return failure("UNSUPPORTED_MEDIA_TYPE");
    const bytes = await readBounded(request, JSON_BODY_BYTES);
    if (typeof bytes === "string") return failure(bytes);
    try {
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // falls through
    }
    return failure("INVALID_REQUEST");
  }

  const guarded =
    (
      kind: Kind,
      post: boolean,
      handler: (ownerId: string, service: EnrollmentService, request: Request) => Promise<Response>,
    ) =>
    async (request: Request): Promise<Response> => {
      try {
        const ready = await prelude(request, kind, post);
        if (ready instanceof Response) return ready;
        return await handler(ready.ownerId, ready.service, request);
      } catch {
        return failure("UNAVAILABLE");
      }
    };

  return {
    status: guarded("status", false, async (ownerId, service) => {
      const view = await service.status(ownerId);
      return respond({ ...view }, 200);
    }),

    redeem: guarded("redeem", true, async (ownerId, service, request) => {
      const body = await jsonBody(request);
      if (body instanceof Response) return body;
      const keys = Object.keys(body);
      const invitation = body.invitation;
      if (keys.length !== 1 || typeof invitation !== "string" || !INVITATION.test(invitation))
        return failure("INVALID_REQUEST");
      const result = await service.redeem(ownerId, invitation);
      return result.ok
        ? respond({ status: result.status, expiresAt: result.expiresAt }, 200)
        : failure(result.code, result.retryAfterSeconds);
    }),

    disconnect: guarded("disconnect", true, async (ownerId, service, request) => {
      const body = await jsonBody(request);
      if (body instanceof Response) return body;
      if (Object.keys(body).length !== 0) return failure("INVALID_REQUEST");
      const result = await service.disconnect(ownerId);
      return result.ok
        ? respond({ status: "not-connected", revoked: result.revoked }, 200)
        : failure(result.code);
    }),

    reports: guarded("reports", true, async (ownerId, service, request) => {
      const parsed = await parseReportRequest(request);
      if (typeof parsed === "string") return failure(parsed);

      const submit = async (force: boolean) => {
        const access = await service.accessToken(ownerId, force);
        if (!access.ok) return access;
        return deps.client.submitReport({
          accessToken: access.token,
          reportId: parsed.id,
          report: parsed.report,
          media: parsed.media,
        });
      };

      let outcome = await submit(false);
      // Framebriar refused the cached access token: it may simply have been replaced. Refresh once and try again before
      // concluding anything about the enrollment.
      if ("kind" in outcome && outcome.kind === "rejected" && outcome.status === 401)
        outcome = await submit(true);

      if ("ok" in outcome) return failure(outcome.code, outcome.retryAfterSeconds);
      if (outcome.kind === "uncertain") return failure("UNCERTAIN");
      if (outcome.kind === "rejected") {
        if (outcome.status === 401 || outcome.status === 403) {
          await service.markEnded(ownerId, outcome.status === 401 ? "revoked" : "disabled");
          return failure(outcome.status === 401 ? "REVOKED" : "DISABLED");
        }
        if (outcome.status === 429) return failure("RATE_LIMITED", outcome.retryAfterSeconds);
        if (outcome.status === 413) return failure("TOO_LARGE");
        return failure(
          outcome.status === 400 || outcome.status === 422 ? "INVALID_REQUEST" : "UPSTREAM",
        );
      }
      // Delivered only when Framebriar's receipt is for exactly this report and this game.
      if (
        outcome.value.id.toLowerCase() !== parsed.id.toLowerCase() ||
        outcome.value.gameId !== GAME_ID
      )
        return failure("UPSTREAM");
      return respond({ id: parsed.id, gameId: GAME_ID, status: "ready" }, 200);
    }),
  };
}

export type FeedbackRoutes = ReturnType<typeof createFeedbackRoutes>;
