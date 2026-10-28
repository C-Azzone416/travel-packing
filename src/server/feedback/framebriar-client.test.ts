import { describe, expect, it, vi } from "vitest";
import { FRAMEBRIAR_ENDPOINT, GAME_ID, createFramebriarClient } from "./framebriar-client";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const grant = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  gameId: GAME_ID,
  scopeVersion: 2,
  token: "a".repeat(32),
  refreshToken: "r".repeat(32),
  expiresAt: iso(3_600_000),
  refreshExpiresAt: iso(30 * 86_400_000),
  ...overrides,
});

function clientFor(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  diagnostics: { timingNow?: () => number; log?: (line: string) => void } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return {
    client: createFramebriarClient({ fetchImpl, now: () => NOW, ...diagnostics }),
    calls,
  };
}
const ok = (body: unknown) => Response.json(body);

describe("every call", () => {
  it("goes to the one fixed address, with no redirects, no cookies, no cache and a timeout", async () => {
    const { client, calls } = clientFor(() => ok(grant()));
    await client.redeem({ invitation: "i".repeat(43), attemptId: "x" });
    await client.refresh("r".repeat(32));
    await client.disconnect("r".repeat(32));
    expect(calls.map((call) => call.url)).toEqual([
      `${FRAMEBRIAR_ENDPOINT}/v1/access/redeem`,
      `${FRAMEBRIAR_ENDPOINT}/v1/access/refresh`,
      `${FRAMEBRIAR_ENDPOINT}/v1/access/disconnect`,
    ]);
    for (const { init } of calls) {
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("treats a network failure, a timeout and any 5xx as uncertain", async () => {
    for (const respond of [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      () => new Response("down", { status: 503 }),
      () => new Response("boom", { status: 500 }),
    ]) {
      expect(await clientFor(respond).client.refresh("r".repeat(32))).toEqual({
        kind: "uncertain",
      });
    }
  });

  it("does not emit upload diagnostics for enrollment calls", async () => {
    const lines: string[] = [];
    const { client } = clientFor(() => ok(grant()), { log: (line) => lines.push(line) });
    await client.redeem({ invitation: "i".repeat(43), attemptId: "x" });
    await client.refresh("r".repeat(32));
    await client.disconnect("r".repeat(32));
    expect(lines).toEqual([]);
  });

  it("reports a refusal's status and a sane Retry-After, never its text", async () => {
    const { client } = clientFor(
      () => new Response("secret provider text", { status: 429, headers: { "retry-after": "17" } }),
    );
    const outcome = await client.refresh("r".repeat(32));
    expect(outcome).toEqual({ kind: "rejected", status: 429, retryAfterSeconds: 17 });
    for (const header of ["abc", "-5", "999999", ""]) {
      const refused = await clientFor(
        () => new Response("x", { status: 429, headers: { "retry-after": header } }),
      ).client.refresh("r".repeat(32));
      expect(refused).toEqual({ kind: "rejected", status: 429 });
    }
  });

  it("is uncertain about an answer that is not JSON, has no body, or is larger than the cap", async () => {
    expect(await clientFor(() => new Response("nope")).client.refresh("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
    expect(
      await clientFor(() => new Response(null, { status: 200 })).client.refresh("r".repeat(32)),
    ).toEqual({
      kind: "uncertain",
    });
    const huge = JSON.stringify({ ...grant(), padding: "x".repeat(40_000) });
    expect(await clientFor(() => new Response(huge)).client.refresh("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
    const failing = new ReadableStream({
      pull() {
        throw new Error("stream broke");
      },
    });
    expect(await clientFor(() => new Response(failing)).client.refresh("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
  });
});

describe("a grant is trusted only when it is well formed", () => {
  it("accepts a good grant and converts the times", async () => {
    const outcome = await clientFor(() => ok(grant())).client.redeem({
      invitation: "i".repeat(43),
      attemptId: "x",
    });
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        accessToken: "a".repeat(32),
        accessExpiresAt: NOW + 3_600_000,
        refreshToken: "r".repeat(32),
        refreshExpiresAt: NOW + 30 * 86_400_000,
      },
    });
  });

  it.each([
    ["another game", { gameId: "other" }],
    ["another scope version", { scopeVersion: 1 }],
    ["another protocol version", { v: 2 }],
    ["a short access token", { token: "short" }],
    ["a missing refresh credential", { refreshToken: undefined }],
    ["an access token that already expired", { expiresAt: iso(-1000) }],
    ["an access token that lives far too long", { expiresAt: iso(5 * 3_600_000) }],
    ["a family deadline in the past", { refreshExpiresAt: iso(-1000), expiresAt: iso(-2000) }],
    [
      "an access token outliving the family deadline",
      { refreshExpiresAt: iso(1_800_000), expiresAt: iso(3_600_000) },
    ],
    ["a time that is not a date", { expiresAt: "tomorrow-ish" }],
    ["a time that is not a string", { expiresAt: 12345 }],
  ])("is uncertain for %s", async (_name, overrides) => {
    const outcome = await clientFor(() => ok(grant(overrides))).client.redeem({
      invitation: "i".repeat(43),
      attemptId: "x",
    });
    expect(outcome).toEqual({ kind: "uncertain" });
  });

  it("refuses a refresh that changes the refresh credential", async () => {
    const outcome = await clientFor(() =>
      ok(grant({ refreshToken: "z".repeat(32) })),
    ).client.refresh("r".repeat(32));
    expect(outcome).toEqual({ kind: "uncertain" });
  });

  it("refuses a non-object answer", async () => {
    expect(await clientFor(() => ok("string")).client.refresh("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
    expect(await clientFor(() => ok(null)).client.refresh("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
  });

  it("sends the attempt id and invitation only in the redeem body", async () => {
    const { client, calls } = clientFor(() => ok(grant()));
    await client.redeem({ invitation: "inv-" + "i".repeat(40), attemptId: "attempt-1" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      v: 1,
      gameId: GAME_ID,
      scopeVersion: 2,
      invitation: "inv-" + "i".repeat(40),
      attemptId: "attempt-1",
    });
  });
});

describe("disconnect", () => {
  it("is ok on a v1 answer and uncertain otherwise", async () => {
    expect(
      await clientFor(() => ok({ v: 1, disconnected: true })).client.disconnect("r".repeat(32)),
    ).toEqual({
      kind: "ok",
      value: true,
    });
    expect(await clientFor(() => ok({ nothing: 1 })).client.disconnect("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
    expect(await clientFor(() => ok(null)).client.disconnect("r".repeat(32))).toEqual({
      kind: "uncertain",
    });
  });
});

describe("submitReport", () => {
  const receipt = (extra: Record<string, unknown> = {}) => ({
    id: "11111111-1111-4111-8111-111111111111",
    gameId: GAME_ID,
    status: "ready",
    ...extra,
  });
  const png = new Uint8Array([1, 2, 3]);

  it("logs only closed, content-free diagnostics for metadata and media delivery", async () => {
    const lines: string[] = [];
    const times = [100, 104, 105, 117];
    const answers = [
      receipt({ status: "pending", ticket: "ticket-secret-value" }),
      new Response("private upstream failure", { status: 503 }),
    ];
    const report = JSON.stringify({
      id: "private-report-id",
      note: "Private note owner@example.test",
      signedUrl: "https://storage.example.test/private?sas=secret",
    });
    const { client } = clientFor(
      () => {
        const answer = answers.shift();
        return answer instanceof Response ? answer : ok(answer);
      },
      {
        timingNow: () => times.shift()!,
        log: (line) => lines.push(line),
      },
    );

    expect(
      await client.submitReport({
        accessToken: "access-token-secret-value",
        report,
        media: new TextEncoder().encode("private screenshot bytes"),
      }),
    ).toEqual({ kind: "uncertain" });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        scope: "feedback",
        event: "framebriar_upstream",
        phase: "metadata",
        outcome: "ok",
        elapsedMs: 4,
        status: 200,
      },
      {
        scope: "feedback",
        event: "framebriar_upstream",
        phase: "media",
        outcome: "upstream",
        elapsedMs: 12,
        status: 503,
      },
    ]);
    const serialized = lines.join("\n");
    for (const forbidden of [
      "private-report-id",
      "Private note",
      "owner@example.test",
      "storage.example.test",
      "ticket-secret-value",
      "access-token-secret-value",
      "private screenshot bytes",
      "private upstream failure",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ["timeout", () => new DOMException("secret timeout detail", "TimeoutError"), "timeout"],
    ["network", () => new TypeError("secret network detail"), "network"],
  ])(
    "keeps a %s failure category bounded and preserves the uncertain result",
    async (_name, error, outcome) => {
      const lines: string[] = [];
      const times = [10, 70];
      const { client } = clientFor(
        () => {
          throw error();
        },
        { timingNow: () => times.shift()!, log: (line) => lines.push(line) },
      );

      expect(
        await client.submitReport({
          accessToken: "secret-access-token",
          report: '{"note":"secret report text"}',
          media: null,
        }),
      ).toEqual({ kind: "uncertain" });
      expect(JSON.parse(lines[0])).toEqual({
        scope: "feedback",
        event: "framebriar_upstream",
        phase: "metadata",
        outcome,
        elapsedMs: 60,
      });
      expect(lines[0]).not.toMatch(/secret|detail|token|report text/i);
    },
  );

  it("keeps the uncertain result when the diagnostic sink throws", async () => {
    const { client } = clientFor(() => new Response("private upstream failure", { status: 503 }), {
      timingNow: () => 10,
      log: () => {
        throw new Error("logging unavailable");
      },
    });
    await expect(
      client.submitReport({
        accessToken: "secret-access-token",
        report: '{"note":"secret report text"}',
        media: null,
      }),
    ).resolves.toEqual({ kind: "uncertain" });
  });

  it("delivers a report without media in one call, with the bearer token", async () => {
    const { client, calls } = clientFor(() => ok(receipt()));
    const outcome = await client.submitReport({
      accessToken: "t".repeat(32),
      report: '{"id":"x"}',
      media: null,
    });
    expect(outcome).toEqual({
      kind: "ok",
      value: { id: "11111111-1111-4111-8111-111111111111", gameId: GAME_ID },
    });
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${"t".repeat(32)}`,
    );
    expect(calls[0].init.body).toBe('{"id":"x"}');
  });

  it("uploads the PNG with the ticket once the report is pending, and is done only when that is ready", async () => {
    const answers = [receipt({ status: "pending", ticket: "ticket-123" }), receipt()];
    const { client, calls } = clientFor(() => ok(answers.shift()));
    const outcome = await client.submitReport({
      accessToken: "t".repeat(32),
      report: "{}",
      media: png,
    });
    expect(outcome.kind).toBe("ok");
    expect(calls[1].url).toBe(
      `${FRAMEBRIAR_ENDPOINT}/v1/reports/11111111-1111-4111-8111-111111111111/media`,
    );
    expect(calls[1].init.method).toBe("PUT");
    expect(calls[1].init.headers).toMatchObject({
      "content-type": "image/png",
      "x-upload-ticket": "ticket-123",
    });
  });

  it("is uncertain when the shape is wrong: no ticket, a ticket but no media, an upload that is not ready", async () => {
    for (const [answers, media] of [
      [[receipt({ status: "pending" })], png],
      [[receipt({ status: "pending", ticket: "t" })], null],
      [[receipt({ status: "weird" })], png],
      [[receipt({ status: "pending", ticket: "t" }), receipt({ status: "pending" })], png],
      [[receipt({ gameId: "other" })], null],
      [[{ id: 5 }], null],
      [["text"], null],
    ] as const) {
      const queue = [...answers];
      const { client } = clientFor(() => ok(queue.shift()));
      const outcome = await client.submitReport({
        accessToken: "t".repeat(32),
        report: "{}",
        media,
      });
      expect(outcome.kind).toBe("uncertain");
    }
  });

  it("passes a refusal from either call through", async () => {
    const first = clientFor(() => new Response("x", { status: 401 }));
    expect(
      await first.client.submitReport({ accessToken: "t".repeat(32), report: "{}", media: null }),
    ).toEqual({
      kind: "rejected",
      status: 401,
    });
    const answers = [
      ok(receipt({ status: "pending", ticket: "t" })),
      new Response("x", { status: 400 }),
    ];
    const second = clientFor(() => answers.shift()!);
    expect(
      await second.client.submitReport({ accessToken: "t".repeat(32), report: "{}", media: png }),
    ).toEqual({
      kind: "rejected",
      status: 400,
    });
  });

  it("uses the real fetch when none is injected", () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    return createFramebriarClient()
      .refresh("r".repeat(32))
      .then((outcome) => {
        expect(outcome).toEqual({ kind: "uncertain" });
        spy.mockRestore();
      });
  });
});
