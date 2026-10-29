// A stand-in for the app's four Framebriar routes (#259, `/api/feedback/enrollment[/redeem|/disconnect]` and `/api/feedback/reports`),
// as a `fetch`, for the browser-side tests (#260). It follows the frozen contract: v1 JSON, no-store, the status enum, the coded
// errors, and a report accepted only for a connected, signed-in account. Nothing here is a credential: it knows no token, and it
// records only the route, the method and whether a report was accepted. It is a test double and never ships.

import type { DisconnectOutcome, EnrollmentState } from "@/features/feedback/enrollment-client";

export type Route = "status" | "redeem" | "disconnect" | "reports";

export type Failure =
  | { kind: "network" }
  | { kind: "malformed" }
  | { kind: "status"; status: number; error?: string; retryAfterSeconds?: number };

export interface FakeFeedbackState {
  status: EnrollmentState;
  expiresAt: string | null;
  redemption: "none" | "pending";
  outboxKey: string | null;
  session: "in" | "out" | "forbidden";
  /** What the next redeem does when nothing else is queued. */
  redeem: "connected" | "rejected" | "uncertain";
  /** What a disconnect reports when it works. */
  revoked: boolean;
  /** Overrides what a working disconnect reports; otherwise "ended" when `revoked` and it was connected, else "nothing". */
  disconnectOutcome?: DisconnectOutcome;
  /** Overrides whether the server holds a record; otherwise true for any state but not-connected, or a pending redemption. */
  hasRecord?: boolean;
}

export const OUTBOX_KEY_A = "KA".padEnd(43, "a");
export const OUTBOX_KEY_B = "KB".padEnd(43, "b");

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const error = (status: number, code: string, retryAfterSeconds?: number) =>
  json(
    status,
    { v: 1, error: code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) },
    retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
  );

export function createFakeFeedbackServer(initial: Partial<FakeFeedbackState> = {}) {
  const state: FakeFeedbackState = {
    status: "not-connected",
    expiresAt: null,
    redemption: "none",
    outboxKey: OUTBOX_KEY_A,
    session: "in",
    redeem: "connected",
    revoked: true,
    ...initial,
  };
  const failures = new Map<Route, Failure[]>();
  const calls: { route: Route; method: string }[] = [];
  const delivered: string[] = [];
  const invitations: string[] = [];

  function routeOf(url: string): Route | null {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/feedback/enrollment") return "status";
    if (path === "/api/feedback/enrollment/redeem") return "redeem";
    if (path === "/api/feedback/enrollment/disconnect") return "disconnect";
    if (path === "/api/feedback/reports") return "reports";
    return null;
  }

  async function handle(input: string, init: RequestInit = {}): Promise<Response> {
    const route = routeOf(input);
    const method = init.method ?? "GET";
    if (!route) return error(404, "NOT_FOUND");
    calls.push({ route, method });
    const queued = failures.get(route)?.shift();
    if (queued?.kind === "network") throw new TypeError("Failed to fetch");
    if (queued?.kind === "malformed") {
      return new Response("<html>bad gateway</html>", { status: 200 });
    }
    if (queued?.kind === "status") {
      return error(queued.status, queued.error ?? "UNAVAILABLE", queued.retryAfterSeconds);
    }
    if (state.session === "out") return error(401, "UNAUTHENTICATED");
    if (state.session === "forbidden") return error(403, "FORBIDDEN");

    if (route === "status") {
      return json(200, {
        v: 1,
        status: state.status,
        expiresAt: state.expiresAt,
        redemption: state.redemption,
        hasRecord:
          state.hasRecord ?? (state.status !== "not-connected" || state.redemption === "pending"),
        outboxKey: state.outboxKey,
      });
    }
    if (route === "redeem") {
      const body = JSON.parse(String(init.body ?? "{}")) as { invitation?: string };
      invitations.push(String(body.invitation));
      if (state.status === "connected") return error(409, "ALREADY_CONNECTED");
      if (state.redeem === "rejected") {
        state.redemption = "none";
        return error(422, "INVITATION_REJECTED");
      }
      if (state.redeem === "uncertain") {
        state.redemption = "pending";
        return error(502, "UNCERTAIN");
      }
      state.status = "connected";
      state.redemption = "none";
      state.expiresAt ??= "2026-11-19T12:00:00.000Z";
      return json(200, { v: 1, status: "connected", expiresAt: state.expiresAt });
    }
    if (route === "disconnect") {
      const had = state.status === "connected";
      const outcome: DisconnectOutcome =
        state.disconnectOutcome ?? (had && state.revoked ? "ended" : "nothing");
      state.status = "not-connected";
      state.expiresAt = null;
      state.redemption = "none";
      state.hasRecord = undefined;
      return json(200, { v: 1, status: "not-connected", outcome, revoked: outcome === "ended" });
    }
    // reports
    if (state.status !== "connected") {
      const code = {
        "not-connected": "NOT_CONNECTED",
        needs_reconnect: "NEEDS_RECONNECT",
        expired: "EXPIRED",
        revoked: "REVOKED",
        disabled: "DISABLED",
      }[state.status as "not-connected" | "needs_reconnect" | "expired" | "revoked" | "disabled"];
      return code ? error(409, code) : error(503, "UNAVAILABLE");
    }
    const form = init.body as FormData;
    const report = JSON.parse(await (form.get("report") as Blob).text()) as {
      id: string;
      gameId: string;
    };
    delivered.push(report.id);
    return json(200, { v: 1, id: report.id, gameId: report.gameId, status: "ready" });
  }

  return {
    state,
    fetch: handle as unknown as typeof fetch,
    calls,
    delivered,
    invitations,
    count: (route: Route) => calls.filter((call) => call.route === route).length,
    failNext(route: Route, failure: Failure) {
      failures.set(route, [...(failures.get(route) ?? []), failure]);
    },
  };
}

export type FakeFeedbackServer = ReturnType<typeof createFakeFeedbackServer>;

/** A small in-memory IndexedDB factory: enough to list and delete databases, which is all the account scope does. */
export function createMemoryIdb(names: string[] = []) {
  const present = new Set(names);
  const deleted: string[] = [];
  const blocked = new Set<string>();
  const factory = {
    databases: async () => [...present].map((name) => ({ name, version: 1 })),
    deleteDatabase(name: string) {
      const request: {
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = { onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (blocked.has(name)) {
          request.onblocked?.();
          return;
        }
        present.delete(name);
        deleted.push(name);
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, present, deleted, blocked, add: (name: string) => present.add(name) };
}
