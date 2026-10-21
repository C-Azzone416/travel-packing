// framebriar-fake-service: a local stand-in for the shared Framebriar service, for unit and e2e tests ONLY (#130).
// Nothing in the app imports this file, and the client-bundle scan fails the build if its marker ever reaches a bundle.
// It speaks the wire contract the pinned SDK expects (invite redeem / refresh / disconnect, report intake, media upload,
// CORS) with the SDK's own report validation, so a test exercises the real SDK against it without any network.
// It never logs, and it records requests by method, route and status only: no tokens, invitations, bodies or notes.
import { createHash, randomBytes } from "node:crypto";
import { LIMITS, normalizeReport, type NormalizedReport } from "@masra91/framebriar/protocol";

export const FAKE_FRAMEBRIAR_MARKER = "framebriar-fake-service";
/** The endpoint the SDK pins (FEEDBACK_ENDPOINT); the SDK refuses any other, so tests intercept this address. */
export const FRAMEBRIAR_ENDPOINT = "https://framebriar-masra91-poc.azurewebsites.net/api";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type FakeRoute = "redeem" | "refresh" | "disconnect" | "report" | "media";
export type FakeFailure =
  | { kind: "status"; status: 401 | 403 | 404 | 409 | 429 | 500 | 503; retryAfterSeconds?: number }
  | { kind: "network" }
  | { kind: "malformed" };

export interface DeliveredReport {
  report: NormalizedReport;
  /** Present once the media arrived and its hash and size matched. */
  media: { bytes: number } | null;
}

export interface RecordedRequest {
  method: string;
  route: FakeRoute | "preflight" | "other";
  /** 0: the request never got an answer (a simulated network failure). */
  status: number;
}

/** Thrown from `handle` when a test simulates the network being down; callers map it to a failed fetch. */
export class FakeNetworkError extends TypeError {
  constructor() {
    super("Failed to fetch");
  }
}

interface Family {
  refreshToken: string;
  refreshExpiresAt: number;
  revoked: boolean;
  attemptId: string | null;
  access: Set<string>;
}

export interface FakeFramebriarOptions {
  gameId?: string;
  now?: () => number;
  /** Origins that get CORS headers. Default: any http://localhost:<port> or 127.0.0.1 page. */
  allowedOrigins?: readonly string[];
}

const token = () => randomBytes(32).toString("base64url");
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export function createFakeFramebriar({
  gameId = "travel-packing",
  now = Date.now,
  allowedOrigins,
}: FakeFramebriarOptions = {}) {
  const invitations = new Map<string, { usesLeft: number; expiresAt: number }>();
  const families = new Map<string, Family>(); // by refresh token
  const tickets = new Map<string, string>(); // upload ticket -> report id
  const reports = new Map<string, { fingerprint: string; delivered: DeliveredReport }>();
  const failures = new Map<FakeRoute, FakeFailure[]>();
  const log: RecordedRequest[] = [];
  let down = false;

  const originAllowed = (origin: string | null) =>
    origin !== null &&
    (allowedOrigins
      ? allowedOrigins.includes(origin)
      : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

  function familyFor(access: string): Family | undefined {
    for (const family of families.values()) if (family.access.has(access)) return family;
    return undefined;
  }

  async function dispatch(request: Request, cors: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, "");
    const reply = (body: unknown, status: number, extra: Record<string, string> = {}) =>
      json(body, status, { ...cors, ...extra });
    const reject = (status: number) =>
      reply({ error: status === 401 ? "Unauthorized" : "Request rejected" }, status);
    const respond = (route: FakeRoute, response: Response) => {
      log.push({ method: request.method, route, status: response.status });
      return response;
    };

    const access = /^\/v1\/access\/(redeem|refresh|disconnect)$/.exec(path)?.[1] as
      "redeem" | "refresh" | "disconnect" | undefined;
    const mediaId = /^\/v1\/reports\/([0-9a-f-]{36})\/media$/i.exec(path)?.[1];
    const route: FakeRoute | null = access
      ? access
      : path === "/v1/reports"
        ? "report"
        : mediaId
          ? "media"
          : null;
    if (!route) {
      log.push({ method: request.method, route: "other", status: 404 });
      return reply({ error: "Not found" }, 404);
    }

    const queued = failures.get(route)?.shift();
    if (queued) {
      if (queued.kind === "network") {
        log.push({ method: request.method, route, status: 0 });
        throw new FakeNetworkError();
      }
      if (queued.kind === "malformed")
        return respond(
          route,
          new Response("not json", {
            status: 200,
            headers: { "content-type": "application/json", ...cors },
          }),
        );
      const extra: Record<string, string> =
        queued.retryAfterSeconds === undefined
          ? {}
          : { "retry-after": String(queued.retryAfterSeconds) };
      return respond(route, reply({ error: "Request rejected" }, queued.status, extra));
    }

    if (access) {
      if (request.method !== "POST") return respond(route, reject(405));
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return respond(route, reject(400));
      }
      if (body?.v !== 1) return respond(route, reject(400));
      if (access === "redeem") return respond(route, redeem(body, reply, reject));
      if (access === "refresh") return respond(route, refresh(body, reply, reject));
      const family = families.get(String(body.refreshToken));
      if (!family) return respond(route, reject(401));
      family.revoked = true;
      family.access.clear();
      return respond(route, reply({ v: 1, disconnected: true }, 200));
    }

    const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const family = bearer ? familyFor(bearer) : undefined;
    if (!family || family.revoked || family.refreshExpiresAt <= now())
      return respond(route, reject(401));

    if (route === "report") {
      if (request.method !== "POST") return respond(route, reject(405));
      let report: NormalizedReport;
      try {
        report = normalizeReport(await request.json());
      } catch {
        return respond(route, reject(400));
      }
      if (report.gameId !== gameId) return respond(route, reject(403));
      const fingerprint = JSON.stringify(report);
      const known = reports.get(report.id);
      if (known && known.fingerprint !== fingerprint) return respond(route, reject(409));
      if (!known) reports.set(report.id, { fingerprint, delivered: { report, media: null } });
      const delivered = reports.get(report.id)!.delivered;
      if (report.media === null || delivered.media) {
        return respond(route, reply({ id: report.id, gameId, status: "ready" }, 200));
      }
      const ticket = token();
      tickets.set(ticket, report.id);
      return respond(route, reply({ id: report.id, gameId, status: "pending", ticket }, 200));
    }

    // media
    if (request.method !== "PUT") return respond(route, reject(405));
    const ticket = request.headers.get("x-upload-ticket") ?? "";
    const id = mediaId!.toLowerCase();
    const entry = reports.get(id);
    if (!entry || tickets.get(ticket) !== id) return respond(route, reject(403));
    const bytes = Buffer.from(await request.arrayBuffer());
    const expected = entry.delivered.report.media;
    if (
      request.headers.get("content-type") !== "image/png" ||
      !expected ||
      bytes.length > LIMITS.media ||
      bytes.length !== expected.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256
    )
      return respond(route, reject(400));
    entry.delivered.media = { bytes: bytes.length };
    tickets.delete(ticket);
    return respond(route, reply({ id, gameId, status: "ready" }, 200));
  }

  function redeem(
    body: Record<string, unknown>,
    reply: (body: unknown, status: number) => Response,
    reject: (status: number) => Response,
  ): Response {
    if (body.gameId !== gameId || body.scopeVersion !== 2) return reject(403);
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : null;
    // A retried redemption with the same attempt id gets the same family back and spends nothing more.
    const retried = attemptId
      ? [...families.values()].find((family) => family.attemptId === attemptId && !family.revoked)
      : undefined;
    const family = retried ?? newFamily(body.invitation, attemptId);
    if (!family) return reject(401);
    return reply(accessResponse(family), 200);
  }

  function newFamily(invitation: unknown, attemptId: string | null): Family | undefined {
    const invite = typeof invitation === "string" ? invitations.get(invitation) : undefined;
    if (!invite || invite.usesLeft <= 0 || invite.expiresAt <= now()) return undefined;
    invite.usesLeft -= 1;
    const family: Family = {
      refreshToken: token(),
      refreshExpiresAt: now() + 30 * DAY,
      revoked: false,
      attemptId,
      access: new Set(),
    };
    families.set(family.refreshToken, family);
    return family;
  }

  function refresh(
    body: Record<string, unknown>,
    reply: (body: unknown, status: number) => Response,
    reject: (status: number) => Response,
  ): Response {
    const family = families.get(String(body.refreshToken));
    if (!family || family.revoked || family.refreshExpiresAt <= now() || body.scopeVersion !== 2)
      return reject(401);
    return reply(accessResponse(family), 200);
  }

  function accessResponse(family: Family) {
    const access = token();
    family.access.add(access);
    // The SDK requires: access within the hour, refresh credential and family deadline unchanged on refresh.
    const expiresAt = Math.min(now() + HOUR, family.refreshExpiresAt);
    return {
      v: 1,
      gameId,
      scopeVersion: 2,
      token: access,
      refreshToken: family.refreshToken,
      expiresAt: new Date(expiresAt).toISOString(),
      refreshExpiresAt: new Date(family.refreshExpiresAt).toISOString(),
    };
  }

  async function handle(request: Request): Promise<Response> {
    if (down) {
      log.push({ method: request.method, route: "other", status: 0 });
      throw new FakeNetworkError();
    }
    const origin = request.headers.get("origin");
    const cors: Record<string, string> = originAllowed(origin)
      ? {
          "access-control-allow-origin": origin!,
          "access-control-allow-headers": "content-type, authorization, x-upload-ticket",
          "access-control-allow-methods": "POST, PUT, OPTIONS",
          "access-control-expose-headers": "retry-after",
          vary: "Origin",
        }
      : {};
    if (origin && !originAllowed(origin)) {
      log.push({ method: request.method, route: "other", status: 403 });
      return json({ error: "Request rejected" }, 403, {});
    }
    if (request.method === "OPTIONS") {
      log.push({ method: "OPTIONS", route: "preflight", status: 204 });
      return new Response(null, { status: 204, headers: cors });
    }
    return dispatch(request, cors);
  }

  return {
    endpoint: FRAMEBRIAR_ENDPOINT,
    gameId,
    handle,
    /** A drop-in for `fetch` (the SDK's `fetchImpl`); a simulated outage rejects like a real failed fetch. */
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)),
    /** A new invitation code (43 base64url characters, like the real one). */
    issueInvitation({
      uses = 1,
      expiresInMs = 7 * DAY,
    }: { uses?: number; expiresInMs?: number } = {}) {
      const code = token();
      invitations.set(code, { usesLeft: uses, expiresAt: now() + expiresInMs });
      return code;
    },
    /** Makes the next `times` requests to `route` fail the given way. */
    failNext(route: FakeRoute, failure: FakeFailure, times = 1) {
      failures.set(route, [
        ...(failures.get(route) ?? []),
        ...Array.from({ length: times }, () => failure),
      ]);
    },
    /** Every request throws a network error until turned back on. */
    setOffline(offline: boolean) {
      down = offline;
    },
    /** The owner revokes every enrollment: refresh and uploads answer 401 from now on. */
    revokeAll() {
      for (const family of families.values()) {
        family.revoked = true;
        family.access.clear();
      }
    },
    delivered: (): DeliveredReport[] => [...reports.values()].map((entry) => entry.delivered),
    requests: (): readonly RecordedRequest[] => log,
    count: (route: FakeRoute) => log.filter((entry) => entry.route === route).length,
  };
}

export type FakeFramebriar = ReturnType<typeof createFakeFramebriar>;
