// A synthetic Framebriar service for the SERVER tests (#259): a fetch stand-in that speaks the wire contract the server client uses
// (redeem with an idempotent attempt id, refresh, disconnect, report intake, media upload). It imports no SDK and opens no
// network, so it runs anywhere. Tests only; nothing in the app imports it. It records route and status only, never a body.
import { createHash, randomBytes } from "node:crypto";
import { FRAMEBRIAR_ENDPOINT, GAME_ID } from "../framebriar-client";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const token = () => randomBytes(32).toString("base64url");

type Route = "redeem" | "refresh" | "disconnect" | "report" | "media";
export type Failure =
  | { kind: "status"; status: number; retryAfterSeconds?: number }
  | { kind: "network" }
  | { kind: "malformed" }
  | { kind: "lost-response" };

interface Family {
  refreshToken: string;
  refreshExpiresAt: number;
  revoked: boolean;
  attemptId: string;
  access: Set<string>;
}

export function createFakeService(now: () => number = Date.now) {
  const invitations = new Map<string, number>();
  const families = new Map<string, Family>();
  const reports = new Map<string, { body: string; media: boolean }>();
  const tickets = new Map<string, string>();
  const failures = new Map<Route, Failure[]>();
  const log: { route: Route | "other"; status: number }[] = [];
  const urls: string[] = [];
  let lifetime = 30 * DAY;
  let disabled = false;
  let refreshDelay: Promise<void> | null = null;

  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  function grant(family: Family) {
    const access = token();
    family.access.add(access);
    return {
      v: 1,
      gameId: GAME_ID,
      scopeVersion: 2,
      token: access,
      refreshToken: family.refreshToken,
      expiresAt: new Date(Math.min(now() + HOUR, family.refreshExpiresAt)).toISOString(),
      refreshExpiresAt: new Date(family.refreshExpiresAt).toISOString(),
    };
  }

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = request.url;
    urls.push(url);
    const path = new URL(url).pathname.replace(/^\/api/, "");
    const route: Route | null =
      path === "/v1/access/redeem"
        ? "redeem"
        : path === "/v1/access/refresh"
          ? "refresh"
          : path === "/v1/access/disconnect"
            ? "disconnect"
            : path === "/v1/reports"
              ? "report"
              : /^\/v1\/reports\/[0-9a-f-]{36}\/media$/i.test(path)
                ? "media"
                : null;
    if (!route || !url.startsWith(FRAMEBRIAR_ENDPOINT)) {
      log.push({ route: "other", status: 404 });
      return reply({ error: "Not found" }, 404);
    }
    const done = (response: Response) => {
      log.push({ route, status: response.status });
      return response;
    };
    const queued = failures.get(route)?.shift();
    if (queued) {
      if (queued.kind === "network") throw new TypeError("Failed to fetch");
      if (queued.kind === "malformed") return done(new Response("not json", { status: 200 }));
      if (queued.kind === "status")
        return done(
          reply(
            { error: "Request rejected" },
            queued.status,
            queued.retryAfterSeconds ? { "retry-after": String(queued.retryAfterSeconds) } : {},
          ),
        );
    }
    const lostResponse = queued?.kind === "lost-response";

    let response: Response;
    if (route === "redeem" || route === "refresh" || route === "disconnect") {
      const body = (await request.json()) as Record<string, unknown>;
      if (disabled && route !== "disconnect") return done(reply({ error: "disabled" }, 403));
      if (route === "redeem") {
        const attemptId = String(body.attemptId);
        const retried = [...families.values()].find((family) => family.attemptId === attemptId);
        const spent = invitations.get(String(body.invitation));
        let family = retried;
        if (!family) {
          if (spent === undefined || spent <= 0 || body.gameId !== GAME_ID)
            return done(reply({ error: "no" }, 401));
          invitations.set(String(body.invitation), spent - 1);
          family = {
            refreshToken: token(),
            refreshExpiresAt: now() + lifetime,
            revoked: false,
            attemptId,
            access: new Set(),
          };
          families.set(family.refreshToken, family);
        }
        response = reply(grant(family));
      } else {
        const family = families.get(String(body.refreshToken));
        if (!family || family.revoked || family.refreshExpiresAt <= now())
          return done(reply({ error: "no" }, 401));
        if (route === "refresh") {
          if (refreshDelay) await refreshDelay;
          response = reply(grant(family));
        } else {
          family.revoked = true;
          family.access.clear();
          response = reply({ v: 1, disconnected: true });
        }
      }
    } else {
      const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
      const family = [...families.values()].find((candidate) => candidate.access.has(bearer));
      if (!family || family.revoked || family.refreshExpiresAt <= now())
        return done(reply({ error: "no" }, 401));
      if (disabled) return done(reply({ error: "disabled" }, 403));
      if (route === "report") {
        const text = await request.text();
        const report = JSON.parse(text) as { id: string; media: unknown };
        const known = reports.get(report.id);
        if (known && known.body !== text) return done(reply({ error: "conflict" }, 409));
        reports.set(report.id, { body: text, media: known?.media ?? false });
        if (report.media === null || reports.get(report.id)?.media)
          response = reply({ id: report.id, gameId: GAME_ID, status: "ready" });
        else {
          const ticket = token();
          tickets.set(ticket, report.id);
          response = reply({ id: report.id, gameId: GAME_ID, status: "pending", ticket });
        }
      } else {
        const id = /\/reports\/([0-9a-f-]{36})\//i.exec(path)![1];
        const ticket = request.headers.get("x-upload-ticket") ?? "";
        const entry = reports.get(id);
        if (!entry || tickets.get(ticket) !== id) return done(reply({ error: "no" }, 403));
        const bytes = Buffer.from(await request.arrayBuffer());
        const declared = (JSON.parse(entry.body) as { media: { bytes: number; sha256: string } })
          .media;
        if (
          request.headers.get("content-type") !== "image/png" ||
          bytes.length !== declared.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== declared.sha256
        )
          return done(reply({ error: "bad" }, 400));
        entry.media = true;
        tickets.delete(ticket);
        response = reply({ id, gameId: GAME_ID, status: "ready" });
      }
    }
    log.push({ route, status: response.status });
    // The service did the work but the answer never reached the caller.
    if (lostResponse) throw new TypeError("Failed to fetch");
    return response;
  }

  return {
    fetch: handle as typeof fetch,
    issueInvitation(uses = 1) {
      const code = token();
      invitations.set(code, uses);
      return code;
    },
    failNext(route: Route, failure: Failure, times = 1) {
      failures.set(route, [
        ...(failures.get(route) ?? []),
        ...Array.from({ length: times }, () => failure),
      ]);
    },
    setLifetime: (ms: number) => void (lifetime = ms),
    disable: (value = true) => void (disabled = value),
    /** Holds every refresh answer until `release` is called, so a test can make several requests overlap. */
    holdRefresh() {
      let release!: () => void;
      refreshDelay = new Promise<void>(
        (resolve) =>
          (release = () => {
            refreshDelay = null;
            resolve();
          }),
      );
      return release;
    },
    revokeAll() {
      for (const family of families.values()) {
        family.revoked = true;
        family.access.clear();
      }
    },
    familyCount: () => families.size,
    activeFamilies: () => [...families.values()].filter((family) => !family.revoked).length,
    delivered: () => [...reports.keys()],
    deliveredMedia: (id: string) => reports.get(id)?.media === true,
    count: (route: Route) => log.filter((entry) => entry.route === route).length,
    urls: () => urls,
  };
}

export type FakeService = ReturnType<typeof createFakeService>;
