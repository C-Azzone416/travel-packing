import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth, type FakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";
import { setAuthLogSink } from "@/server/auth/safe-log";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { createFakeService, type FakeService } from "./__fixtures__/fake-service";
import { createEnrollmentService } from "./enrollment-service";
import { FRAMEBRIAR_ENDPOINT, createFramebriarClient } from "./framebriar-client";
import { parseKeyRing } from "./key-ring";
import {
  LOCAL_ORIGIN,
  createFeedbackRoutes,
  feedbackServerEnabled,
  trustedOrigins,
} from "./routes";

const PREVIEW = "https://travel-packing-preview.vercel.app";
const OWNER = { email: "owner@example.test", password: "pw", userId: "owner_1" };
const OTHER = { email: "other@example.test", password: "pw", userId: "owner_2" };
const KEY = randomBytes(32).toString("base64");

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
let fake: FakeService;
let auth: FakeAuth;
let clock = Date.parse("2026-10-26T12:00:00Z");
let logs: unknown[][];

beforeAll(async () => {
  ctx = await createMigratedDb();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await resetData(ctx.client);
  clock = Date.parse("2026-10-26T12:00:00Z");
  fake = createFakeService(() => clock);
  auth = createFakeAuth([OWNER, OTHER]);
  logs = [];
  setAuthLogSink((line) => logs.push([line]));
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));
});
afterEach(() => {
  setAuthLogSink();
  vi.restoreAllMocks();
});

function routesFor(
  env: Record<string, string | undefined> = { VERCEL_ENV: "preview" },
  keys = KEY,
) {
  const client = createFramebriarClient({ fetchImpl: fake.fetch, now: () => clock });
  const service = createEnrollmentService({
    db: ctx.db as unknown as Db,
    client,
    keys: () =>
      parseKeyRing(keys ? JSON.stringify({ current: "k1", keys: { k1: keys } }) : undefined),
    now: () => clock,
  });
  return createFeedbackRoutes({
    getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
    getService: async () => service,
    client,
    env,
    now: () => clock,
  });
}

const signIn = (who = OWNER) => auth.signInWithPassword(who.email, who.password);
const url = (path: string) => `${PREVIEW}/api/feedback/${path}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(path), {
    method: "POST",
    headers: { origin: PREVIEW, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path: string) => new Request(url(path), { method: "GET" });
const body = async (response: Response) => (await response.json()) as Record<string, unknown>;

async function connected(routes = routesFor()) {
  await signIn();
  const invitation = fake.issueInvitation();
  const response = await routes.redeem(post("enrollment/redeem", { invitation }));
  expect(response.status).toBe(200);
  return { routes, invitation };
}

const png = (extra = 32) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    randomBytes(extra),
  ]);
function reportFor(media: Buffer | null, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: randomUUID(),
    gameId: "travel-packing",
    buildSha: "abcdef1",
    scene: "trips",
    notes: "Synthetic note",
    media: media
      ? {
          type: "image/png",
          bytes: media.length,
          sha256: createHash("sha256").update(media).digest("hex"),
        }
      : null,
    ...overrides,
  };
}
function reportRequest(
  report: unknown,
  media: Buffer | null,
  {
    headers = {},
    extra = {},
  }: { headers?: Record<string, string>; extra?: Record<string, string> } = {},
) {
  const form = new FormData();
  form.set(
    "report",
    new File([JSON.stringify(report)], "report.json", { type: "application/json" }),
  );
  if (media)
    form.set("media", new File([new Uint8Array(media)], "shot.png", { type: "image/png" }));
  for (const [name, value] of Object.entries(extra)) form.set(name, value);
  return new Request(url("reports"), {
    method: "POST",
    headers: { origin: PREVIEW, ...headers },
    body: form,
  });
}

describe("the build gate", () => {
  it.each([
    [{ VERCEL_ENV: "preview" }, true],
    [{ NODE_ENV: "development" }, true],
    [{ NEXT_PUBLIC_E2E_BUILD: "1" }, true],
    [{ VERCEL_ENV: "production" }, false],
    [{ VERCEL_ENV: "production", NEXT_PUBLIC_E2E_BUILD: "1", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "production" }, false],
    [{}, false],
  ])("%j is enabled: %s", (env, enabled) => {
    expect(feedbackServerEnabled(env)).toBe(enabled);
  });

  it("every route answers 404 in a production build, signed in or not, and touches nothing", async () => {
    const routes = routesFor({ VERCEL_ENV: "production" });
    await signIn();
    for (const response of [
      await routes.status(get("enrollment")),
      await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) })),
      await routes.disconnect(post("enrollment/disconnect", {})),
      await routes.reports(reportRequest(reportFor(null), null)),
    ]) {
      expect(response.status).toBe(404);
      expect(await body(response)).toEqual({ v: 1, error: "NOT_FOUND" });
    }
    expect(fake.urls()).toEqual([]);
  });

  it("trusts exactly the stable Preview origin on Preview, localhost:8080 in development, its own origin in e2e", () => {
    const request = new Request("https://some-other-deployment.vercel.app/api/feedback/reports");
    expect(trustedOrigins(request, { VERCEL_ENV: "preview" })).toEqual([PREVIEW]);
    expect(trustedOrigins(request, { NODE_ENV: "development" })).toEqual([LOCAL_ORIGIN]);
    expect(trustedOrigins(request, { NEXT_PUBLIC_E2E_BUILD: "1" })).toEqual([
      "https://some-other-deployment.vercel.app",
    ]);
    expect(trustedOrigins(request, {})).toEqual([]);
  });
});

describe("authentication, origin, content type, size and rate", () => {
  it("signed out is 401 and an account off the allowlist is 403, on every route", async () => {
    const routes = routesFor();
    const requests = () => [
      routes.status(get("enrollment")),
      routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) })),
      routes.disconnect(post("enrollment/disconnect", {})),
      routes.reports(reportRequest(reportFor(null), null)),
    ];
    for (const response of await Promise.all(requests())) expect(response.status).toBe(401);
    await signIn(OTHER);
    for (const response of await Promise.all(requests())) expect(response.status).toBe(403);
    expect(fake.urls()).toEqual([]);
  });

  it("the owner is the session's, never anything the request says", async () => {
    const routes = routesFor();
    await signIn();
    const invitation = fake.issueInvitation();
    const response = await routes.redeem(
      post("enrollment/redeem", { invitation, ownerId: OTHER.userId }),
    );
    expect(response.status).toBe(400);
    await routes.redeem(post("enrollment/redeem", { invitation }));
    await signIn(OWNER);
    expect((await body(await routes.status(get("enrollment")))).status).toBe("connected");
  });

  it.each([
    ["no Origin header", undefined],
    ["a foreign Origin", "https://evil.example"],
    ["a different Preview deployment", "https://travel-packing-abc123.vercel.app"],
    ["localhost on Preview", LOCAL_ORIGIN],
  ])("a POST with %s is 403 BAD_ORIGIN and does nothing", async (_name, origin) => {
    const routes = routesFor();
    await signIn();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    for (const request of [
      new Request(url("enrollment/redeem"), {
        method: "POST",
        headers,
        body: JSON.stringify({ invitation: "A".repeat(43) }),
      }),
      new Request(url("enrollment/disconnect"), { method: "POST", headers, body: "{}" }),
    ]) {
      const response =
        await routes[request.url.includes("redeem") ? "redeem" : "disconnect"](request);
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ v: 1, error: "BAD_ORIGIN" });
    }
    const report = reportRequest(reportFor(null), null, { headers: origin ? { origin } : {} });
    if (!origin) report.headers.delete("origin");
    expect((await routes.reports(report)).status).toBe(403);
    expect(fake.urls()).toEqual([]);
  });

  it("status needs no Origin but is read-only", async () => {
    const routes = routesFor();
    await signIn();
    expect((await routes.status(get("enrollment"))).status).toBe(200);
  });

  it("insists on the exact JSON content type and bounds the body while reading it", async () => {
    const routes = routesFor();
    await signIn();
    const invitation = "A".repeat(43);
    expect(
      (
        await routes.redeem(
          post("enrollment/redeem", { invitation }, { "content-type": "text/plain" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await routes.redeem(
          post(
            "enrollment/redeem",
            { invitation },
            { "content-type": "application/json-patch+json" },
          ),
        )
      ).status,
    ).toBe(415);
    expect(
      (await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(5000) }))).status,
    ).toBe(413);
    // A lying Content-Length does not matter: the stream is counted.
    const chunked = new Request(url("enrollment/redeem"), {
      method: "POST",
      headers: { origin: PREVIEW, "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"invitation":"${"B".repeat(3000)}"}`));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect((await routes.redeem(chunked)).status).toBe(413);
    for (const bad of [
      "not json",
      "[]",
      '"x"',
      "null",
      '{"invitation":5}',
      '{"invitation":"short"}',
      '{"invitation":"has spaces in it 1234567890"}',
    ]) {
      expect((await routesFor().redeem(post("enrollment/redeem", bad))).status).toBe(400);
    }
    expect((await routes.disconnect(post("enrollment/disconnect", { force: true }))).status).toBe(
      400,
    );
    expect(fake.count("redeem")).toBe(0);
  });

  it("each route is rate limited per owner, with Retry-After, and one owner does not slow another", async () => {
    const routes = routesFor();
    await signIn();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) }))).status,
      ).toBe(422);
    }
    const limited = await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await body(limited)).toMatchObject({
      error: "RATE_LIMITED",
      retryAfterSeconds: expect.any(Number),
    });
    auth.current = { userId: OTHER.userId, email: OWNER.email };
    expect(
      (await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) }))).status,
    ).toBe(422);
  });

  it("an unreachable database is 503 UNAVAILABLE, not a crash", async () => {
    const routes = createFeedbackRoutes({
      getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
      getService: async () => null,
      client: createFramebriarClient({ fetchImpl: fake.fetch }),
      env: { VERCEL_ENV: "preview" },
    });
    await signIn();
    const response = await routes.status(get("enrollment"));
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ v: 1, error: "UNAVAILABLE" });
    const throwing = createFeedbackRoutes({
      getAuth: async () => {
        throw new Error("secret detail");
      },
      getService: async () => null,
      client: createFramebriarClient({ fetchImpl: fake.fetch }),
      env: { VERCEL_ENV: "preview" },
    });
    const crashed = await throwing.status(get("enrollment"));
    expect(crashed.status).toBe(503);
    expect(JSON.stringify(await body(crashed))).not.toContain("secret");
  });
});

describe("enrollment routes", () => {
  it("status, redeem, status, disconnect, status", async () => {
    const routes = routesFor();
    await signIn();
    const first = await body(await routes.status(get("enrollment")));
    expect(first).toMatchObject({
      v: 1,
      status: "not-connected",
      expiresAt: null,
      redemption: "none",
      hasRecord: false,
    });
    expect(first.outboxKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const redeemed = await routes.redeem(
      post("enrollment/redeem", { invitation: fake.issueInvitation() }),
    );
    expect(redeemed.headers.get("cache-control")).toBe("no-store");
    expect(await body(redeemed)).toEqual({
      v: 1,
      status: "connected",
      expiresAt: new Date(clock + 30 * 86_400_000).toISOString(),
    });
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      status: "connected",
    });

    expect(await body(await routes.disconnect(post("enrollment/disconnect", {})))).toEqual({
      v: 1,
      status: "not-connected",
      outcome: "ended",
      revoked: true,
    });
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      status: "not-connected",
    });
  });

  it("maps every failure to its code and status", async () => {
    const routes = routesFor();
    await signIn();
    const invitation = fake.issueInvitation(5);
    fake.failNext("redeem", { kind: "network" });
    expect((await routes.redeem(post("enrollment/redeem", { invitation }))).status).toBe(502);
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      redemption: "pending",
    });
    expect((await routes.redeem(post("enrollment/redeem", { invitation }))).status).toBe(200);
    expect(await body(await routes.redeem(post("enrollment/redeem", { invitation })))).toEqual({
      v: 1,
      error: "ALREADY_CONNECTED",
    });
    fake.failNext("disconnect", { kind: "network" });
    expect((await routes.disconnect(post("enrollment/disconnect", {}))).status).toBe(502);
  });

  it("disconnect answers with the real outcome and a distinct code for each failure (#304)", async () => {
    const { routes } = await connected();
    fake.failNext("disconnect", { kind: "network" });
    const uncertain = await routes.disconnect(post("enrollment/disconnect", {}));
    expect(uncertain.status).toBe(502);
    expect(await body(uncertain)).toEqual({ v: 1, error: "UNCERTAIN" });
    const done = await routes.disconnect(post("enrollment/disconnect", {}));
    expect(await body(done)).toEqual({
      v: 1,
      status: "not-connected",
      outcome: "ended",
      revoked: true,
    });
    // Nothing held now: "nothing", with hasRecord already false.
    expect(await body(await routes.disconnect(post("enrollment/disconnect", {})))).toEqual({
      v: 1,
      status: "not-connected",
      outcome: "nothing",
      revoked: false,
    });
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({ hasRecord: false });
  });

  it("disconnect while a connection attempt is pending is a 409 PENDING_REDEMPTION, and status shows a record", async () => {
    const routes = routesFor();
    await signIn();
    fake.failNext("redeem", { kind: "lost-response" });
    await routes.redeem(post("enrollment/redeem", { invitation: fake.issueInvitation() }));
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      redemption: "pending",
      hasRecord: true,
    });
    const refused = await routes.disconnect(post("enrollment/disconnect", {}));
    expect(refused.status).toBe(409);
    expect(await body(refused)).toEqual({ v: 1, error: "PENDING_REDEMPTION" });
  });

  it("disconnect that ends the access but cannot erase the copy is a 503 PARTIAL", async () => {
    const client = createFramebriarClient({ fetchImpl: fake.fetch, now: () => clock });
    const real = ctx.db as unknown as Db;
    const service = createEnrollmentService({
      db: new Proxy(real as object, {
        get(target, property, receiver) {
          if (property === "delete") {
            return () => {
              throw new Error("down");
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as unknown as Db,
      client,
      keys: () => parseKeyRing(JSON.stringify({ current: "k1", keys: { k1: KEY } })),
      now: () => clock,
    });
    const routes = createFeedbackRoutes({
      getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
      getService: async () => service,
      client,
      env: { VERCEL_ENV: "preview" },
      now: () => clock,
    });
    await connected(routes);
    const partial = await routes.disconnect(post("enrollment/disconnect", {}));
    expect(partial.status).toBe(503);
    expect(await body(partial)).toEqual({ v: 1, error: "PARTIAL" });
  });

  it("a missing key ring makes every enrollment route unavailable (and the status says so), with no network call", async () => {
    const routes = routesFor({ VERCEL_ENV: "preview" }, "");
    await signIn();
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      status: "unavailable",
    });
    expect(
      (await routes.redeem(post("enrollment/redeem", { invitation: "A".repeat(43) }))).status,
    ).toBe(503);
    expect((await routes.reports(reportRequest(reportFor(null), null))).status).toBe(503);
    expect(fake.urls()).toEqual([]);
  });

  it("a key ring that cannot open the row is needs_reconnect; a new invitation replaces it", async () => {
    await connected();
    const other = routesFor({ VERCEL_ENV: "preview" }, randomBytes(32).toString("base64"));
    expect(await body(await other.status(get("enrollment")))).toMatchObject({
      status: "needs_reconnect",
      expiresAt: null,
    });
    expect(await body(await other.reports(reportRequest(reportFor(null), null)))).toEqual({
      v: 1,
      error: "NEEDS_RECONNECT",
    });
    expect((await other.reports(reportRequest(reportFor(null), null))).status).toBe(409);
    expect(
      await body(
        await other.redeem(post("enrollment/redeem", { invitation: fake.issueInvitation() })),
      ),
    ).toMatchObject({ status: "connected" });
    expect(await body(await other.status(get("enrollment")))).toMatchObject({
      status: "connected",
    });
    expect((await other.reports(reportRequest(reportFor(null), null))).status).toBe(200);
  });

  it("two accounts never see each other's enrollment through the routes", async () => {
    const routes = routesFor();
    await connected(routes);
    await signIn(OTHER);
    auth.current = { userId: OTHER.userId, email: OWNER.email };
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      status: "not-connected",
    });
    expect((await routes.reports(reportRequest(reportFor(null), null))).status).toBe(409);
    expect(fake.delivered()).toEqual([]);
  });
});

describe("the report proxy", () => {
  it("delivers a text report and answers ready only for the matching receipt", async () => {
    const { routes } = await connected();
    const report = reportFor(null);
    const response = await routes.reports(reportRequest(report, null));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      v: 1,
      id: report.id,
      gameId: "travel-packing",
      status: "ready",
    });
    expect(fake.delivered()).toEqual([report.id]);
  });

  it("delivers a report with its screenshot in two calls, checking size and hash", async () => {
    const { routes } = await connected();
    const media = png(2000);
    const report = reportFor(media);
    const response = await routes.reports(reportRequest(report, media));
    expect(response.status).toBe(200);
    expect(fake.deliveredMedia(report.id)).toBe(true);
    expect(fake.count("media")).toBe(1);
  });

  it("retrying the same report after a lost answer is safe and delivers it once", async () => {
    const { routes } = await connected();
    const report = reportFor(null);
    fake.failNext("report", { kind: "lost-response" });
    expect((await routes.reports(reportRequest(report, null))).status).toBe(502);
    expect((await routes.reports(reportRequest(report, null))).status).toBe(200);
    expect(fake.delivered()).toEqual([report.id]);
  });

  it("only ever talks to the fixed Framebriar address, whatever the request carries", async () => {
    const { routes } = await connected();
    const sneaky = reportFor(null, {
      endpoint: "http://169.254.169.254/latest",
      url: "https://evil.example/collect",
      destination: "https://evil.example",
    });
    const response = await routes.reports(reportRequest(sneaky, null, { extra: {} }));
    expect(response.status).toBe(200);
    for (const target of fake.urls()) expect(target.startsWith(FRAMEBRIAR_ENDPOINT)).toBe(true);
    // Extra form fields are refused outright.
    const refused = await routes.reports(
      reportRequest(reportFor(null), null, { extra: { endpoint: "https://evil.example" } }),
    );
    expect(refused.status).toBe(400);
    for (const target of fake.urls())
      expect(new URL(target).host).toBe(new URL(FRAMEBRIAR_ENDPOINT).host);
  });

  it.each([
    ["another game", (m: Buffer | null) => reportFor(m, { gameId: "someone-else" })],
    ["another protocol version", (m: Buffer | null) => reportFor(m, { v: 2 })],
    ["a report id that is not a uuid", (m: Buffer | null) => reportFor(m, { id: "../../etc" })],
    ["a malformed build id", (m: Buffer | null) => reportFor(m, { buildSha: "main; drop table" })],
    ["media declared but none attached", () => reportFor(png())],
  ])("refuses %s", async (_name, make) => {
    const { routes } = await connected();
    const response = await routes.reports(reportRequest(make(null), null));
    expect(response.status).toBe(400);
    expect(fake.count("report")).toBe(0);
  });

  it("refuses a screenshot that does not match what the report declares, or is not a PNG", async () => {
    const { routes } = await connected();
    const media = png(500);
    for (const [report, attached, status] of [
      [
        reportFor(media, {
          media: {
            type: "image/png",
            bytes: media.length + 1,
            sha256: createHash("sha256").update(media).digest("hex"),
          },
        }),
        media,
        400,
      ],
      [
        reportFor(media, {
          media: { type: "image/png", bytes: media.length, sha256: "0".repeat(64) },
        }),
        media,
        400,
      ],
      [reportFor(null), media, 400],
      [
        reportFor(Buffer.from("GIF89a-not-a-png-at-all")),
        Buffer.from("GIF89a-not-a-png-at-all"),
        400,
      ],
    ] as const) {
      expect((await routes.reports(reportRequest(report, attached))).status).toBe(status);
    }
    expect(fake.count("report")).toBe(0);
  });

  it("refuses the wrong content types, extra parts and oversized bodies", async () => {
    const { routes } = await connected();
    const json = new Request(url("reports"), {
      method: "POST",
      headers: { origin: PREVIEW, "content-type": "application/json" },
      body: JSON.stringify(reportFor(null)),
    });
    expect((await routes.reports(json)).status).toBe(415);

    const wrongPart = new FormData();
    wrongPart.set("report", new File(["{}"], "r.txt", { type: "text/plain" }));
    expect(
      (
        await routes.reports(
          new Request(url("reports"), {
            method: "POST",
            headers: { origin: PREVIEW },
            body: wrongPart,
          }),
        )
      ).status,
    ).toBe(400);

    const wrongMedia = new FormData();
    wrongMedia.set(
      "report",
      new File([JSON.stringify(reportFor(png()))], "r.json", { type: "application/json" }),
    );
    wrongMedia.set("media", new File([new Uint8Array(png())], "x.jpg", { type: "image/jpeg" }));
    expect(
      (
        await routes.reports(
          new Request(url("reports"), {
            method: "POST",
            headers: { origin: PREVIEW },
            body: wrongMedia,
          }),
        )
      ).status,
    ).toBe(415);

    const bigReport = new FormData();
    bigReport.set(
      "report",
      new File(["x".repeat(300 * 1024)], "r.json", { type: "application/json" }),
    );
    expect(
      (
        await routes.reports(
          new Request(url("reports"), {
            method: "POST",
            headers: { origin: PREVIEW },
            body: bigReport,
          }),
        )
      ).status,
    ).toBe(413);

    const declaredHuge = new Request(url("reports"), {
      method: "POST",
      headers: {
        origin: PREVIEW,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(20 * 1024 * 1024),
      },
      body: "x",
    });
    expect((await routes.reports(declaredHuge)).status).toBe(413);
    expect(fake.count("report")).toBe(0);
  });

  it("answers by enrollment state: not connected, expired, revoked, disabled; the status route then agrees", async () => {
    const routes = routesFor();
    await signIn();
    const send = async () => routes.reports(reportRequest(reportFor(null), null));
    expect(await body(await send())).toEqual({ v: 1, error: "NOT_CONNECTED" });

    await connected(routes);
    fake.revokeAll();
    expect(await body(await send())).toEqual({ v: 1, error: "REVOKED" });
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({ status: "revoked" });

    await routes.redeem(post("enrollment/redeem", { invitation: fake.issueInvitation() }));
    fake.disable();
    expect(await body(await send())).toEqual({ v: 1, error: "DISABLED" });
    expect(await body(await routes.status(get("enrollment")))).toMatchObject({
      status: "disabled",
    });

    fake.disable(false);
    await routes.redeem(post("enrollment/redeem", { invitation: fake.issueInvitation() }));
    clock += 31 * 86_400_000;
    expect(await body(await send())).toEqual({ v: 1, error: "EXPIRED" });
  });

  it("a refused access token is refreshed once before the enrollment is judged", async () => {
    const { routes } = await connected();
    fake.failNext("report", { kind: "status", status: 401 });
    expect((await routes.reports(reportRequest(reportFor(null), null))).status).toBe(200);
    expect(fake.count("refresh")).toBe(1);
  });

  it.each([
    [429, 429],
    [413, 413],
    [400, 400],
    [422, 400],
    [418, 502],
  ])("Framebriar answering %s becomes %s without its text", async (upstream, ours) => {
    const { routes } = await connected();
    fake.failNext("report", {
      kind: "status",
      status: upstream,
      retryAfterSeconds: upstream === 429 ? 12 : undefined,
    });
    const response = await routes.reports(reportRequest(reportFor(null), null));
    expect(response.status).toBe(ours);
    expect(JSON.stringify(await body(response))).not.toContain("Request rejected");
  });

  it("a receipt for another report is rejected by the client as an uncertain delivery", async () => {
    const { routes } = await connected();
    const other = randomUUID();
    const forged = createFramebriarClient({
      fetchImpl: (async () =>
        Response.json({
          id: other,
          gameId: "travel-packing",
          status: "ready",
        })) as unknown as typeof fetch,
      now: () => clock,
    });
    const routesWithForgedReceipt = createFeedbackRoutes({
      getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
      getService: async () =>
        ({
          accessToken: async () => ({ ok: true as const, token: "t".repeat(32) }),
        }) as never,
      client: forged,
      env: { VERCEL_ENV: "preview" },
    });
    void routes;
    const response = await routesWithForgedReceipt.reports(reportRequest(reportFor(null), null));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ v: 1, error: "UNCERTAIN" });
  });

  it("an unconfirmed upload (pending after the media call) is not delivery", async () => {
    const { routes } = await connected();
    const media = png(100);
    fake.failNext("media", { kind: "network" });
    const report = reportFor(media);
    expect((await routes.reports(reportRequest(report, media))).status).toBe(502);
    // The retry finishes it.
    expect((await routes.reports(reportRequest(report, media))).status).toBe(200);
    expect(fake.deliveredMedia(report.id)).toBe(true);
  });
});

describe("secrets never leave", () => {
  it("no response, log line or console output holds an invitation, credential, key, owner id, email or screenshot byte", async () => {
    const routes = routesFor();
    await signIn();
    const invitation = fake.issueInvitation();
    const media = png(300);
    const report = reportFor(media);
    const responses = [
      await routes.status(get("enrollment")),
      await routes.redeem(post("enrollment/redeem", { invitation })),
      await routes.reports(reportRequest(report, media)),
      await routes.reports(reportRequest(reportFor(null, { gameId: "nope" }), null)),
      await routes.disconnect(post("enrollment/disconnect", {})),
    ];
    const text =
      (await Promise.all(responses.map((response) => response.text()))).join("\n") +
      JSON.stringify(logs);
    for (const secret of [
      invitation,
      KEY,
      OWNER.userId,
      OWNER.email,
      OWNER.password,
      media.toString("base64"),
    ])
      expect(text).not.toContain(secret);
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(JSON.stringify(logs)).not.toMatch(/token|credential|invitation/i);
  });
});
