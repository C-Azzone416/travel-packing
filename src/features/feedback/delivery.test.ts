import { describe, expect, it, vi } from "vitest";
import type { NormalizedReport } from "@masra91/framebriar/protocol";
import { createFakeFeedbackServer } from "@/test/fake-feedback-server";
import { createProxySend, REPORTS_PATH } from "./delivery";

const report = (over: Partial<NormalizedReport> = {}) =>
  ({
    v: 1,
    id: "6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11",
    gameId: "travel-packing",
    buildSha: null,
    scene: "trips",
    sessionId: "s",
    seed: null,
    platform: "desktop",
    input: "mouse",
    capturedAt: "2026-10-16T12:00:00.000Z",
    notes: "It jumped",
    breadcrumbs: [],
    media: null,
    ...over,
  }) as NormalizedReport;
const png = () => new Blob([new Uint8Array(8)], { type: "image/png" });
const withMedia = () => report({ media: { type: "image/png", bytes: 8, sha256: "0".repeat(64) } });

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers,
    })) as unknown as typeof fetch;

async function outcome(promise: Promise<unknown>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    const e = error as { code?: string; retryAfterMs?: number; name?: string };
    return { ok: false as const, code: e.code, retryAfterMs: e.retryAfterMs, name: e.name };
  }
}

describe("the report request", () => {
  it("is one multipart POST to the app's own route with the report and the PNG, authorized by the cookie alone", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const server = createFakeFeedbackServer({ status: "connected" });
    const spy = (async (path: string, init: RequestInit) => {
      seen.push({ path, init });
      return server.fetch(path, init);
    }) as unknown as typeof fetch;
    const r = withMedia();
    const result = await createProxySend({ fetchImpl: spy })({ report: r, media: png() });
    expect(result).toEqual({ id: r.id, gameId: "travel-packing", status: "ready" });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe(REPORTS_PATH);
    expect(seen[0].init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    // No Authorization header, no token, no owner id: the only credential is the session cookie the browser adds itself.
    expect(seen[0].init.headers).toBeUndefined();
    const form = seen[0].init.body as FormData;
    expect([...form.keys()].sort()).toEqual(["media", "report"]);
    expect((form.get("report") as Blob).type).toBe("application/json");
    expect(JSON.parse(await (form.get("report") as Blob).text()).id).toBe(r.id);
    expect((form.get("media") as Blob).type).toBe("image/png");
    expect(server.delivered).toEqual([r.id]);
  });

  it("sends no media part for a text-only report", async () => {
    const seen: FormData[] = [];
    const server = createFakeFeedbackServer({ status: "connected" });
    const spy = (async (path: string, init: RequestInit) => {
      seen.push(init.body as FormData);
      return server.fetch(path, init);
    }) as unknown as typeof fetch;
    await createProxySend({ fetchImpl: spy })({ report: report(), media: null });
    expect([...seen[0].keys()]).toEqual(["report"]);
  });

  it("does not even ask the server while the enrollment is not connected, and keeps the report", async () => {
    const fetchImpl = vi.fn();
    const send = createProxySend({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isConnected: () => false,
    });
    expect(await outcome(send({ report: report(), media: null }))).toMatchObject({
      ok: false,
      code: "access-required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops before any request when already cancelled", async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const send = createProxySend({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(
      await outcome(send({ report: report(), media: null, signal: controller.signal })),
    ).toMatchObject({ code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what each answer means to the outbox", () => {
  const run = (fetchImpl: typeof fetch, options = {}, r = report(), media: Blob | null = null) =>
    outcome(createProxySend({ fetchImpl, ...options })({ report: r, media }));

  it("accepts only a 200 that names this report, this game, and ready", async () => {
    const r = report();
    const good = { v: 1, id: r.id, gameId: "travel-packing", status: "ready" };
    expect(await run(answer(200, good))).toMatchObject({ ok: true });
    for (const bad of [
      { ...good, id: "other" },
      { ...good, gameId: "other-game" },
      { ...good, status: "pending" },
      { ...good, v: 2 },
      { id: r.id },
    ]) {
      expect(await run(answer(200, bad))).toMatchObject({ ok: false, code: "invalid-ack" });
    }
    expect(await run(answer(200, "<html>"))).toMatchObject({ ok: false, code: "invalid-ack" });
    expect(await run(answer(201, good))).toMatchObject({ ok: false, code: "invalid-ack" });
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
  ])("a %s is access-required (kept, retried later)", async (status, code) => {
    expect(await run(answer(status, { v: 1, error: code }))).toMatchObject({
      code: "access-required",
    });
  });

  it.each(["NOT_CONNECTED", "NEEDS_RECONNECT", "EXPIRED", "REVOKED", "DISABLED"] as const)(
    "a 409 %s is access-required and tells the app at once",
    async (code) => {
      const onEnrollmentProblem = vi.fn();
      expect(await run(answer(409, { v: 1, error: code }), { onEnrollmentProblem })).toMatchObject({
        code: "access-required",
      });
      expect(onEnrollmentProblem).toHaveBeenCalledWith(code);
    },
  );

  it("a 409 that is not an enrollment problem is permanent", async () => {
    const onEnrollmentProblem = vi.fn();
    expect(
      await run(answer(409, { v: 1, error: "SOMETHING" }), { onEnrollmentProblem }),
    ).toMatchObject({ code: "permanent" });
    expect(onEnrollmentProblem).not.toHaveBeenCalled();
  });

  it("413 is terminal: invalid-media when there is a screenshot, permanent when there is not", async () => {
    expect(
      await run(answer(413, { v: 1, error: "TOO_LARGE" }), {}, withMedia(), png()),
    ).toMatchObject({ code: "invalid-media" });
    expect(await run(answer(413, { v: 1, error: "TOO_LARGE" }))).toMatchObject({
      code: "permanent",
    });
  });

  it("429 is quota with the server's delay (body, else header) and is announced", async () => {
    const onRateLimited = vi.fn();
    expect(
      await run(answer(429, { v: 1, error: "RATE_LIMITED", retryAfterSeconds: 42 }), {
        onRateLimited,
      }),
    ).toMatchObject({ code: "quota", retryAfterMs: 42_000 });
    expect(onRateLimited).toHaveBeenCalledWith(42);
    expect(await run(answer(429, "x", { "retry-after": "7" }), { onRateLimited })).toMatchObject({
      code: "quota",
      retryAfterMs: 7000,
    });
    expect(await run(answer(429, "x"), { onRateLimited })).toMatchObject({
      code: "quota",
      retryAfterMs: undefined,
    });
    expect(onRateLimited).toHaveBeenLastCalledWith(null);
  });

  it.each([502, 503, 504, 500, 408])(
    "a %s is unavailable (kept, retried with backoff)",
    async (status) => {
      expect(await run(answer(status, { v: 1, error: "UNCERTAIN" }))).toMatchObject({
        code: "unavailable",
      });
    },
  );

  it("carries a Retry-After on a 503", async () => {
    expect(
      await run(answer(503, { v: 1, error: "UNAVAILABLE", retryAfterSeconds: 9 })),
    ).toMatchObject({
      code: "unavailable",
      retryAfterMs: 9000,
    });
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [415, "UNSUPPORTED_MEDIA_TYPE"],
    [403, "BAD_ORIGIN"],
    [404, "NOT_FOUND"],
  ])("a %s %s can never succeed as it is: permanent", async (status, code) => {
    expect(await run(answer(status, { v: 1, error: code }))).toMatchObject({ code: "permanent" });
  });

  it("a request that cannot be made is network; a cancel is cancelled", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await run(down)).toMatchObject({ code: "network" });
    const controller = new AbortController();
    const aborting = (async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    expect(
      await outcome(
        createProxySend({ fetchImpl: aborting })({
          report: report(),
          media: null,
          signal: controller.signal,
        }),
      ),
    ).toMatchObject({ code: "cancelled" });
  });

  it("errors carry no provider text, credential or body", async () => {
    const result = await run(
      answer(502, {
        v: 1,
        error: "UPSTREAM",
        detail: "secret-token-xyz",
        message: "provider says no",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/secret-token|provider says/);
  });
});
