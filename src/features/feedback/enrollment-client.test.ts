import { describe, expect, it } from "vitest";
import { createFakeFeedbackServer, OUTBOX_KEY_A } from "@/test/fake-feedback-server";
import {
  DISCONNECT_PATH,
  disconnectEnrollment,
  ENROLLMENT_PATH,
  readEnrollment,
  redeemInvitation,
  REDEEM_PATH,
} from "./enrollment-client";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers,
    })) as unknown as typeof fetch;

describe("readEnrollment", () => {
  it("asks the status route with the session cookie, no caching and no body, and returns what the server said", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const server = createFakeFeedbackServer({
      status: "connected",
      expiresAt: "2026-12-01T00:00:00Z",
    });
    const spy = (async (path: string, init: RequestInit) => {
      seen.push({ path, init });
      return server.fetch(path, init);
    }) as unknown as typeof fetch;
    expect(await readEnrollment(spy)).toEqual({
      kind: "ok",
      view: {
        status: "connected",
        expiresAt: "2026-12-01T00:00:00Z",
        redemption: "none",
        outboxKey: OUTBOX_KEY_A,
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe(ENROLLMENT_PATH);
    expect(seen[0].init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(seen[0].init.body).toBeUndefined();
  });

  it.each(["unavailable", "not-connected", "connected", "expired", "revoked", "disabled"] as const)(
    "passes the %s state through",
    async (status) => {
      const result = await readEnrollment(createFakeFeedbackServer({ status }).fetch);
      expect(result).toMatchObject({ kind: "ok", view: { status } });
    },
  );

  it("reports a pending redemption and a missing outbox key", async () => {
    const server = createFakeFeedbackServer({
      redemption: "pending",
      outboxKey: null,
      status: "unavailable",
    });
    expect(await readEnrollment(server.fetch)).toMatchObject({
      kind: "ok",
      view: { redemption: "pending", outboxKey: null },
    });
  });

  it.each([401, 403])("treats a %s as signed out", async (status) => {
    expect(await readEnrollment(reply(status, { v: 1, error: "X" }))).toEqual({
      kind: "signed-out",
    });
  });

  it("reports offline when the request cannot be made at all", async () => {
    const server = createFakeFeedbackServer();
    server.failNext("status", { kind: "network" });
    expect(await readEnrollment(server.fetch)).toEqual({ kind: "offline" });
  });

  it.each([
    ["a server error", reply(500, { v: 1, error: "UNAVAILABLE" })],
    ["an HTML error page", reply(200, "<html>nope</html>")],
    ["a body that is not v1", reply(200, { status: "connected" })],
    [
      "an unknown state",
      reply(200, { v: 1, status: "mystery", expiresAt: null, redemption: "none", outboxKey: null }),
    ],
    [
      "a bad redemption flag",
      reply(200, {
        v: 1,
        status: "connected",
        expiresAt: null,
        redemption: "maybe",
        outboxKey: null,
      }),
    ],
    [
      "a bad expiry",
      reply(200, { v: 1, status: "connected", expiresAt: 5, redemption: "none", outboxKey: null }),
    ],
    [
      "an outbox key that is not URL-safe",
      reply(200, {
        v: 1,
        status: "connected",
        expiresAt: null,
        redemption: "none",
        outboxKey: "../../etc/passwd",
      }),
    ],
    [
      "an outbox key that is too short",
      reply(200, {
        v: 1,
        status: "connected",
        expiresAt: null,
        redemption: "none",
        outboxKey: "abc",
      }),
    ],
    ["a non-object body", reply(200, [1, 2])],
  ])("is an error, not a state, for %s", async (_name, fetchImpl) => {
    expect(await readEnrollment(fetchImpl)).toMatchObject({ kind: "error" });
  });

  it("carries the server's retry delay (body, else header) on an error", async () => {
    expect(
      await readEnrollment(reply(429, { v: 1, error: "RATE_LIMITED", retryAfterSeconds: 12 })),
    ).toEqual({ kind: "error", retryAfterSeconds: 12 });
    expect(
      await readEnrollment(reply(503, { v: 1, error: "UNAVAILABLE" }, { "retry-after": "30" })),
    ).toEqual({
      kind: "error",
      retryAfterSeconds: 30,
    });
    expect(await readEnrollment(reply(503, "x", { "retry-after": "tomorrow" }))).toEqual({
      kind: "error",
      retryAfterSeconds: null,
    });
  });
});

describe("redeemInvitation", () => {
  it("sends exactly the invitation as JSON to the redeem route, with the cookie and no caching", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const server = createFakeFeedbackServer();
    const spy = (async (path: string, init: RequestInit) => {
      seen.push({ path, init });
      return server.fetch(path, init);
    }) as unknown as typeof fetch;
    expect(await redeemInvitation("inv-0123456789abcdef", spy)).toEqual({
      kind: "connected",
      expiresAt: "2026-11-19T12:00:00.000Z",
    });
    expect(seen[0].path).toBe(REDEEM_PATH);
    expect(seen[0].init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ invitation: "inv-0123456789abcdef" });
  });

  it.each([
    [
      "already connected",
      reply(409, { v: 1, error: "ALREADY_CONNECTED" }),
      { kind: "already-connected" },
    ],
    ["rejected", reply(422, { v: 1, error: "INVITATION_REJECTED" }), { kind: "rejected" }],
    ["uncertain", reply(502, { v: 1, error: "UNCERTAIN" }), { kind: "uncertain" }],
    [
      "rate limited",
      reply(429, { v: 1, error: "RATE_LIMITED", retryAfterSeconds: 90 }),
      { kind: "rate-limited", retryAfterSeconds: 90 },
    ],
    ["unavailable", reply(503, { v: 1, error: "UNAVAILABLE" }), { kind: "unavailable" }],
    ["too large", reply(413, { v: 1, error: "TOO_LARGE" }), { kind: "unavailable" }],
    ["a bad origin", reply(403, { v: 1, error: "BAD_ORIGIN" }), { kind: "unavailable" }],
    ["signed out", reply(401, { v: 1, error: "UNAUTHENTICATED" }), { kind: "signed-out" }],
    ["not allowed", reply(403, { v: 1, error: "FORBIDDEN" }), { kind: "signed-out" }],
    [
      "a 200 that is not connected",
      reply(200, { v: 1, status: "not-connected" }),
      { kind: "unavailable" },
    ],
    ["an HTML error page", reply(502, "<html>"), { kind: "uncertain" }],
  ])("maps %s", async (_name, fetchImpl, expected) => {
    expect(await redeemInvitation("inv-0123456789abcdef", fetchImpl)).toEqual(expected);
  });

  it("reports offline when the request cannot be made", async () => {
    const server = createFakeFeedbackServer();
    server.failNext("redeem", { kind: "network" });
    expect(await redeemInvitation("inv-0123456789abcdef", server.fetch)).toEqual({
      kind: "offline",
    });
  });

  it("never keeps or repeats the invitation: one call, one request", async () => {
    const server = createFakeFeedbackServer({ redeem: "uncertain" });
    await redeemInvitation("inv-0123456789abcdef", server.fetch);
    expect(server.count("redeem")).toBe(1);
  });
});

describe("disconnectEnrollment", () => {
  it("posts an empty object to the disconnect route", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const server = createFakeFeedbackServer({ status: "connected" });
    const spy = (async (path: string, init: RequestInit) => {
      seen.push({ path, init });
      return server.fetch(path, init);
    }) as unknown as typeof fetch;
    expect(await disconnectEnrollment(spy)).toEqual({ kind: "done", revoked: true });
    expect(seen[0].path).toBe(DISCONNECT_PATH);
    expect(seen[0].init).toMatchObject({ method: "POST", body: "{}" });
  });

  it("says revoked false when there was nothing to disconnect", async () => {
    expect(await disconnectEnrollment(createFakeFeedbackServer().fetch)).toEqual({
      kind: "done",
      revoked: false,
    });
  });

  it.each([
    ["uncertain", reply(502, { v: 1, error: "UNCERTAIN" })],
    ["unavailable", reply(503, { v: 1, error: "UNAVAILABLE" })],
    ["rate limited", reply(429, { v: 1, error: "RATE_LIMITED" })],
    ["an HTML page", reply(200, "<html>")],
  ])("is a failure, with nothing assumed erased, for %s", async (_name, fetchImpl) => {
    expect(await disconnectEnrollment(fetchImpl)).toEqual({ kind: "failed" });
  });

  it("maps signed out and offline", async () => {
    expect(await disconnectEnrollment(reply(401, { v: 1, error: "UNAUTHENTICATED" }))).toEqual({
      kind: "signed-out",
    });
    const server = createFakeFeedbackServer();
    server.failNext("disconnect", { kind: "network" });
    expect(await disconnectEnrollment(server.fetch)).toEqual({ kind: "offline" });
  });
});
