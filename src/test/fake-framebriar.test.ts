// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_ENDPOINT } from "@masra91/framebriar/browser/feedback-runtime";
import {
  createPlaytestAccess,
  type EnrollmentStore,
} from "@masra91/framebriar/browser/playtest-access";
import {
  FeedbackSubmitError,
  sendPreparedFeedback,
} from "@masra91/framebriar/browser/submit-feedback";
import {
  createFakeFramebriar,
  FakeNetworkError,
  FAKE_FRAMEBRIAR_MARKER,
  FRAMEBRIAR_ENDPOINT,
  type FakeFramebriar,
} from "./fake-framebriar";
import { routeFramebriar, type RouteLike } from "./fake-framebriar-playwright";

const ORIGIN = "http://localhost:3102";

/**
 * The SDK's encrypted IndexedDB store, replaced by memory with the same contract (revision-checked writes). It never
 * notifies its own subscribers: the real one only tells OTHER tabs (BroadcastChannel does not echo to the sender).
 */
function memoryStore(): EnrollmentStore {
  let record: Awaited<ReturnType<EnrollmentStore["read"]>> = { revision: 0, session: null };
  return {
    read: async () => structuredClone(record),
    write: async (session, revision) => {
      if (record.revision !== revision) return false;
      record = { revision, session: { ...session } };
      return true;
    },
    reset: async ({ expectedRevision, notice } = {}) => {
      if (expectedRevision !== undefined && record.revision !== expectedRevision) return null;
      const revision = record.revision + 1;
      record = {
        revision,
        session: null,
        ...(notice
          ? {
              notice: {
                state: notice.state,
                expiresAt: notice.expiresAt ?? null,
                enrolled: notice.enrolled !== false,
              },
            }
          : {}),
      };
      return revision;
    },
    subscribe: () => () => undefined,
    close: () => undefined,
  };
}

function setup(options: { now?: () => number; keepMedia?: boolean } = {}) {
  const fake = createFakeFramebriar(options);
  const store = memoryStore();
  const access = createPlaytestAccess({
    gameId: "travel-packing",
    buildSha: null,
    origin: ORIGIN,
    store,
    fetchImpl: fake.fetch as typeof fetch,
    events: null,
    setTimer: (() => 0) as unknown as typeof setTimeout,
    clearTimer: (() => undefined) as typeof clearTimeout,
    retryDelay: async () => undefined,
    now: options.now,
  });
  return { fake, store, access };
}

const png = (size = 64) => {
  const bytes = Buffer.alloc(size, 7);
  return {
    blob: new Blob([bytes], { type: "image/png" }),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size,
  };
};

function report(over: Record<string, unknown> = {}, media?: ReturnType<typeof png>) {
  return {
    v: 1,
    id: randomUUID(),
    gameId: "travel-packing",
    buildSha: null,
    scene: "trip",
    sessionId: "session-1",
    seed: null,
    platform: "test",
    input: "touch",
    capturedAt: "2026-10-21T12:00:00.000Z",
    notes: "The bag count looks off",
    breadcrumbs: [],
    media: media ? { type: "image/png", bytes: media.size, sha256: media.sha256 } : null,
    ...over,
  };
}

async function connected(fake: FakeFramebriar, access: ReturnType<typeof setup>["access"]) {
  await access.start();
  expect(await access.connect(fake.issueInvitation())).toBe(true);
}

const send = (
  access: ReturnType<typeof setup>["access"],
  body: ReturnType<typeof report>,
  media: Blob | null = null,
) =>
  sendPreparedFeedback({
    report: body,
    media,
    endpoint: access.endpoint,
    getToken: () => access.getToken(),
  });

afterEach(() => vi.unstubAllGlobals());

describe("the fake is wired to the address the SDK pins", () => {
  it("uses the SDK's endpoint and carries a marker the bundle scan looks for", () => {
    expect(FRAMEBRIAR_ENDPOINT).toBe(FEEDBACK_ENDPOINT);
    expect(FAKE_FRAMEBRIAR_MARKER).toBe("framebriar-fake-service");
  });
});

describe("connection, through the real SDK", () => {
  it("redeems an invitation once and reports a connected, capture-ready state", async () => {
    const { fake, access } = setup();
    await access.start();
    expect(access.status()).toMatchObject({ connected: false, canCapture: false });
    const invitation = fake.issueInvitation();
    expect(await access.connect(invitation)).toBe(true);
    expect(access.status()).toMatchObject({
      state: "connected",
      connected: true,
      enrolled: true,
      canCapture: true,
      notice: null,
    });
    expect(await access.getToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const second = setup();
    second.fake.issueInvitation();
    expect(await second.access.connect(invitation)).toBe(false);
    expect(second.access.status().canCapture).toBe(false);
  });

  it("an invitation with one use cannot be redeemed twice, but a retried attempt is not charged again", async () => {
    const { fake, access } = setup();
    await access.start();
    fake.failNext("redeem", { kind: "network" });
    expect(await access.connect(fake.issueInvitation())).toBe(true);
    expect(fake.count("redeem")).toBe(2);
  });

  it("denies an unknown, expired or wrong-game invitation without granting capture", async () => {
    let clock = 1_000_000;
    const { fake, access } = setup({ now: () => clock });
    await access.start();
    expect(await access.connect("A".repeat(43))).toBe(false);
    const expired = fake.issueInvitation({ expiresInMs: 1000 });
    clock += 5000;
    expect(await access.connect(expired)).toBe(false);
    expect(access.status()).toMatchObject({ canCapture: false, notice: "access-required" });
    const response = await fake.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/access/redeem`, {
      method: "POST",
      body: JSON.stringify({
        v: 1,
        invitation: fake.issueInvitation(),
        gameId: "other-game",
        scopeVersion: 2,
      }),
    });
    expect(response.status).toBe(403);
  });

  it("restores the enrollment on start and refreshes without spending the invitation", async () => {
    const { fake, access, store } = setup();
    await connected(fake, access);
    const again = createPlaytestAccess({
      gameId: "travel-packing",
      buildSha: null,
      origin: ORIGIN,
      store,
      fetchImpl: fake.fetch as typeof fetch,
      events: null,
      setTimer: (() => 0) as unknown as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
    });
    expect((await again.start()).connected).toBe(true);
    expect(fake.count("refresh")).toBeGreaterThan(0);
    expect(fake.count("redeem")).toBe(1);
  });

  it("an owner revocation shows the persistent access-required notice and keeps capture eligibility", async () => {
    const { fake, access, store } = setup();
    await connected(fake, access);
    fake.revokeAll();
    const again = createPlaytestAccess({
      gameId: "travel-packing",
      buildSha: null,
      origin: ORIGIN,
      store,
      fetchImpl: fake.fetch as typeof fetch,
      events: null,
      setTimer: (() => 0) as unknown as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
    });
    expect(await again.start()).toMatchObject({
      connected: false,
      canCapture: true,
      notice: "access-required",
    });
  });

  it("an expired family is forgotten with the expired notice", async () => {
    let clock = Date.now();
    const { fake, access, store } = setup({ now: () => clock });
    await connected(fake, access);
    clock += 31 * 86_400_000;
    const later = createPlaytestAccess({
      gameId: "travel-packing",
      buildSha: null,
      origin: ORIGIN,
      store,
      fetchImpl: fake.fetch as typeof fetch,
      events: null,
      now: () => clock,
      setTimer: (() => 0) as unknown as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
    });
    expect((await later.start()).notice).toBe("expired");
  });

  it("an enrollment can be made short, and renewed at full length", async () => {
    let clock = Date.now();
    const fake = createFakeFramebriar({ now: () => clock, enrollmentMs: 60_000 });
    const redeem = async () => {
      const response = await fake.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/access/redeem`, {
        method: "POST",
        body: JSON.stringify({
          v: 1,
          invitation: fake.issueInvitation(),
          gameId: "travel-packing",
          scopeVersion: 2,
        }),
      });
      return (await response.json()) as { expiresAt: string; refreshExpiresAt: string };
    };
    const short = await redeem();
    expect(Date.parse(short.refreshExpiresAt) - clock).toBe(60_000);
    expect(Date.parse(short.expiresAt)).toBe(Date.parse(short.refreshExpiresAt));
    fake.setEnrollmentMs(30 * 86_400_000);
    const full = await redeem();
    expect(Date.parse(full.refreshExpiresAt) - clock).toBe(30 * 86_400_000);
    expect(Date.parse(full.expiresAt) - clock).toBe(3_600_000);
    clock += 61_000;
    expect(clock).toBeGreaterThan(Date.parse(short.refreshExpiresAt));
  });

  it("disconnect forgets locally and revokes on the service", async () => {
    const { fake, access } = setup();
    await connected(fake, access);
    const token = await access.getToken();
    expect(await access.disconnect()).toEqual({ forgotten: true, revoked: true });
    expect(access.status()).toMatchObject({ connected: false, canCapture: false });
    const response = await fake.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(report()),
    });
    expect(response.status).toBe(401);
  });

  it("disconnect still forgets locally when the service cannot be reached", async () => {
    const { fake, access } = setup();
    await connected(fake, access);
    fake.setOffline(true);
    expect(await access.disconnect()).toEqual({ forgotten: true, revoked: false });
    expect(access.status().canCapture).toBe(false);
  });
});

describe("report delivery, through the real SDK", () => {
  it("delivers a text-only report in one step", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    const body = report();
    expect(await send(access, body)).toMatchObject({
      id: body.id,
      status: "ready",
      gameId: "travel-packing",
    });
    expect(fake.delivered()).toHaveLength(1);
    expect(fake.delivered()[0]).toMatchObject({
      media: null,
      report: { notes: "The bag count looks off" },
    });
  });

  it("delivers a screenshot in two steps: report, then media with its upload ticket", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    const shot = png(128);
    const body = report({}, shot);
    expect((await send(access, body, shot.blob)).status).toBe("ready");
    expect(fake.delivered()[0].media).toEqual({ bytes: 128 });
    expect(fake.requests().map((entry) => entry.route)).toEqual(["redeem", "report", "media"]);
  });

  it("keeps the uploaded picture only when asked to, so a test can look at the PNG that was delivered", async () => {
    const keeping = setup({ keepMedia: true });
    vi.stubGlobal("fetch", keeping.fake.fetch);
    await connected(keeping.fake, keeping.access);
    const shot = png(128);
    const body = report({}, shot);
    await send(keeping.access, body, shot.blob);
    expect(keeping.fake.mediaOf(body.id)?.length).toBe(128);
    expect(keeping.fake.mediaOf(body.id.toUpperCase())?.length).toBe(128);
    expect(keeping.fake.mediaOf("00000000-0000-4000-8000-000000000000")).toBeNull();

    const plain = setup();
    vi.stubGlobal("fetch", plain.fake.fetch);
    await connected(plain.fake, plain.access);
    await send(plain.access, body, shot.blob);
    expect(plain.fake.mediaOf(body.id)).toBeNull();
  });

  it("answers a repeated identical report as delivered once, and a changed one with a conflict", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    const body = report();
    await send(access, body);
    await send(access, body);
    expect(fake.delivered()).toHaveLength(1);
    await expect(send(access, { ...body, notes: "Different" })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it.each([
    ["a 401", { kind: "status", status: 401 }, "access-required"],
    ["a 403", { kind: "status", status: 403 }, "access-required"],
    ["a 409", { kind: "status", status: 409 }, "conflict"],
    ["a 404", { kind: "status", status: 404 }, "permanent"],
    ["a 429", { kind: "status", status: 429, retryAfterSeconds: 7 }, "quota"],
    ["a 503", { kind: "status", status: 503, retryAfterSeconds: 3 }, "unavailable"],
    ["a 500", { kind: "status", status: 500 }, "unavailable"],
    ["a dropped connection", { kind: "network" }, "network"],
    ["an acknowledgement that is not JSON", { kind: "malformed" }, "invalid-ack"],
  ] as const)("surfaces %s as the SDK error %s", async (_name, failure, code) => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    fake.failNext("report", failure);
    const error = await send(access, report()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FeedbackSubmitError);
    expect(error).toMatchObject({ code });
    if ("retryAfterSeconds" in failure)
      expect((error as FeedbackSubmitError).retryAfterMs).toBe(failure.retryAfterSeconds * 1000);
    expect(fake.delivered()).toHaveLength(0);
  });

  it("a failed media upload leaves the report pending, and the same report resumes", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    const shot = png();
    const body = report({}, shot);
    fake.failNext("media", { kind: "status", status: 503 });
    await expect(send(access, body, shot.blob)).rejects.toMatchObject({ code: "unavailable" });
    expect(fake.delivered()[0].media).toBeNull();
    expect((await send(access, body, shot.blob)).status).toBe("ready");
    expect(fake.delivered()).toHaveLength(1);
    expect(fake.delivered()[0].media).toEqual({ bytes: shot.size });
  });

  it("an offline service rejects like a failed fetch and recovers when it is back", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    await connected(fake, access);
    fake.setOffline(true);
    await expect(send(access, report())).rejects.toMatchObject({ code: "network" });
    await expect(fake.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/reports`)).rejects.toBeInstanceOf(
      FakeNetworkError,
    );
    fake.setOffline(false);
    expect((await send(access, report())).status).toBe("ready");
  });
});

describe("what the fake itself enforces", () => {
  const call = (fake: FakeFramebriar, path: string, init: RequestInit = {}) =>
    fake.fetch(`${FRAMEBRIAR_ENDPOINT}${path}`, init);
  const authed = async () => {
    const { fake, access } = setup();
    await connected(fake, access);
    const token = (await access.getToken()) as string;
    return { fake, headers: { authorization: `Bearer ${token}` } };
  };

  it("rejects an unknown route, a wrong method, a bad body and a wrong protocol version", async () => {
    const { fake } = setup();
    expect((await call(fake, "/v1/nope")).status).toBe(404);
    expect((await call(fake, "/v1/access/redeem")).status).toBe(405);
    expect((await call(fake, "/v1/access/redeem", { method: "POST", body: "{" })).status).toBe(400);
    expect(
      (await call(fake, "/v1/access/refresh", { method: "POST", body: '{"v":2}' })).status,
    ).toBe(400);
    expect(
      (
        await call(fake, "/v1/access/refresh", {
          method: "POST",
          body: '{"v":1,"refreshToken":"x"}',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(fake, "/v1/access/disconnect", {
          method: "POST",
          body: '{"v":1,"refreshToken":"x"}',
        })
      ).status,
    ).toBe(401);
  });

  it("requires a live bearer token for reports and media", async () => {
    const { fake } = setup();
    expect((await call(fake, "/v1/reports", { method: "POST", body: "{}" })).status).toBe(401);
    expect(
      (
        await call(fake, "/v1/reports", {
          method: "POST",
          headers: { authorization: "Bearer nope" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });

  it("validates the report with the SDK's own rules and checks the game", async () => {
    const { fake, headers } = await authed();
    const post = (body: unknown) =>
      call(fake, "/v1/reports", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ v: 1 })).status).toBe(400);
    expect((await post(report({ gameId: "someone-else" }))).status).toBe(403);
    expect((await call(fake, "/v1/reports", { method: "POST", headers, body: "{" })).status).toBe(
      400,
    );
    expect((await call(fake, "/v1/reports", { headers })).status).toBe(405);
  });

  it("checks the media ticket, type, size and hash", async () => {
    const { fake, headers } = await authed();
    const shot = png(32);
    const body = report({}, shot);
    const ack = await (
      await call(fake, "/v1/reports", { method: "POST", headers, body: JSON.stringify(body) })
    ).json();
    const put = (init: {
      ticket?: string;
      type?: string;
      bytes?: Buffer;
      id?: string;
      method?: string;
    }) =>
      call(fake, `/v1/reports/${init.id ?? body.id}/media`, {
        method: init.method ?? "PUT",
        headers: {
          ...headers,
          "content-type": init.type ?? "image/png",
          "x-upload-ticket": init.ticket ?? ack.ticket,
        },
        body: new Uint8Array(init.bytes ?? Buffer.alloc(32, 7)),
      });
    expect((await put({ method: "POST" })).status).toBe(405);
    expect((await put({ ticket: "wrong" })).status).toBe(403);
    expect((await put({ id: randomUUID() })).status).toBe(403);
    expect((await put({ type: "image/jpeg" })).status).toBe(400);
    expect((await put({ bytes: Buffer.alloc(31, 7) })).status).toBe(400);
    expect((await put({ bytes: Buffer.alloc(32, 9) })).status).toBe(400);
    expect((await put({})).status).toBe(200);
    expect((await put({})).status).toBe(403); // the ticket is spent
  });

  it("answers CORS preflights for local pages and refuses other origins", async () => {
    const { fake } = setup();
    const preflight = (origin: string) =>
      call(fake, "/v1/reports", { method: "OPTIONS", headers: { origin } });
    const ok = await preflight("http://localhost:3102");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3102");
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(ok.headers.get("access-control-allow-headers")).toContain("x-upload-ticket");
    const bad = await preflight("https://evil.example");
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const strict = createFakeFramebriar({ allowedOrigins: ["https://app.example"] });
    const local = await strict.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3102" },
    });
    expect(local.status).toBe(403);
    const listed = await strict.fetch(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example" },
    });
    expect(listed.status).toBe(204);
  });

  it("records method, route and status only: no token, invitation, note or body", async () => {
    const { fake, access } = setup();
    vi.stubGlobal("fetch", fake.fetch);
    const invitation = fake.issueInvitation();
    await access.start();
    await access.connect(invitation);
    const token = (await access.getToken()) as string;
    await send(access, report({ notes: "private words" }));
    const recorded = JSON.stringify(fake.requests());
    for (const secret of [invitation, token, "private words"])
      expect(recorded).not.toContain(secret);
    expect(fake.requests()[0]).toEqual({ method: "POST", route: "redeem", status: 200 });
  });
});

describe("routeFramebriar (Playwright adapter)", () => {
  function harness(fake: FakeFramebriar) {
    let handler: ((route: RouteLike) => Promise<void>) | undefined;
    let pattern = "";
    const target = {
      route: async (url: string, fn: (route: RouteLike) => Promise<void>) => {
        pattern = url;
        handler = fn;
      },
    };
    const run = async (
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      const result: {
        fulfilled?: { status: number; headers: Record<string, string>; body: Buffer };
        aborted?: string;
      } = {};
      await handler!({
        request: () => ({
          url: () => url,
          method: () => init.method ?? "GET",
          allHeaders: async () => init.headers ?? {},
          postDataBuffer: () => (init.body ? Buffer.from(init.body) : null),
        }),
        fulfill: async (response) => {
          result.fulfilled = response;
        },
        abort: async (reason) => {
          result.aborted = reason;
        },
      });
      return result;
    };
    return { target, run, pattern: () => pattern, ready: routeFramebriar(target, fake) };
  }

  it("claims the whole pinned origin", async () => {
    const h = harness(createFakeFramebriar());
    await h.ready;
    expect(h.pattern()).toBe("https://framebriar-masra91-poc.azurewebsites.net/**");
  });

  it("hands the browser's request to the fake and fulfils with its answer, CORS headers included", async () => {
    const fake = createFakeFramebriar();
    const h = harness(fake);
    await h.ready;
    const invitation = fake.issueInvitation();
    const { fulfilled } = await h.run(`${FRAMEBRIAR_ENDPOINT}/v1/access/redeem`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, invitation, gameId: "travel-packing", scopeVersion: 2 }),
    });
    expect(fulfilled?.status).toBe(200);
    expect(fulfilled?.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(JSON.parse(fulfilled!.body.toString())).toMatchObject({ v: 1, scopeVersion: 2 });
    const preflight = await h.run(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    expect(preflight.fulfilled?.status).toBe(204);
  });

  it("fails the request like a dead network when the fake is offline, and rethrows anything else", async () => {
    const fake = createFakeFramebriar();
    const h = harness(fake);
    await h.ready;
    fake.setOffline(true);
    expect((await h.run(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {})).aborted).toBe("failed");
    const broken = harness({
      ...fake,
      handle: async () => {
        throw new Error("bug in the fake");
      },
    } as unknown as FakeFramebriar);
    await broken.ready;
    await expect(broken.run(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, {})).rejects.toThrow(
      "bug in the fake",
    );
  });
});
