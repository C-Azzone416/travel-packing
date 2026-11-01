import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthReference,
  logAccountClosureProviderCall,
  logAllowlistLoaded,
  logAuthEvent,
  setAuthLogSink,
} from "./safe-log";

afterEach(() => {
  setAuthLogSink();
  vi.restoreAllMocks();
});

describe("logAuthEvent", () => {
  it("emits one JSON line with only the scope and event code", () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    logAuthEvent("sign-in-failed");
    expect(lines).toEqual(['{"scope":"auth","event":"sign-in-failed"}']);
  });

  it("writes to console.info by default and can be restored after a custom sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    setAuthLogSink(() => {});
    setAuthLogSink();
    logAuthEvent("sign-out");
    expect(info).toHaveBeenCalledWith('{"scope":"auth","event":"sign-out"}');
  });
});

describe("logAuthEvent with a provider detail", () => {
  const capture = () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    return lines;
  };

  it("adds a three-digit status and a plain machine code, upper-cased, and nothing else", () => {
    const lines = capture();
    logAuthEvent("sign-up-provider-rejected", { status: 403, code: "invalid_origin" });
    expect(lines).toEqual([
      '{"scope":"auth","event":"sign-up-provider-rejected","status":403,"code":"INVALID_ORIGIN"}',
    ]);
  });

  it("adds only a generated support reference", () => {
    const lines = capture();
    const reference = createAuthReference();
    expect(reference).toMatch(/^[0-9a-f]{12}$/);
    logAuthEvent("sign-in-credentials-rejected", { reference });
    logAuthEvent("sign-in-credentials-rejected", { reference: "owner@example.test" });
    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "sign-in-credentials-rejected",
      reference,
    });
    expect(JSON.parse(lines[1])).toEqual({
      scope: "auth",
      event: "sign-in-credentials-rejected",
    });
  });

  it("generates a new support reference for each attempt", () => {
    expect(createAuthReference()).not.toBe(createAuthReference());
  });

  it.each([
    ["a message with an address", "Email owner@example.test is taken"],
    ["lower-case words with spaces", "something went wrong"],
    ["too long", "A".repeat(80)],
    ["too short", "AB"],
    ["a plausible but unapproved machine code", "SOME_CODE"],
    ["a code with a dot", "A.B.C"],
  ])("replaces %s with OTHER", (_name, code) => {
    const lines = capture();
    logAuthEvent("sign-up-provider-rejected", { code });
    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "sign-up-provider-rejected",
      code: "OTHER",
    });
  });

  it("omits a missing machine code instead of inventing one", () => {
    const lines = capture();
    logAuthEvent("sign-in-provider-unavailable", { code: "" });
    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "sign-in-provider-unavailable",
    });
  });

  it.each([[0], [99], [600], [200.5], [Number.NaN]])("drops the impossible status %s", (status) => {
    const lines = capture();
    logAuthEvent("sign-up-provider-rejected", { status });
    expect(JSON.parse(lines[0])).toEqual({ scope: "auth", event: "sign-up-provider-rejected" });
  });

  it("ignores extra fields passed in by mistake", () => {
    const lines = capture();
    logAuthEvent("sign-up-provider-rejected", {
      status: 400,
      email: "owner@example.test",
    } as never);
    expect(lines[0]).not.toContain("owner");
  });
});

describe("logAllowlistLoaded", () => {
  it("logs the entry count and the fingerprint", () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    logAllowlistLoaded(2, "0123456789ab", 1);
    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "allowlist-loaded",
      entries: 2,
      malformed: 1,
      fingerprint: "0123456789ab",
    });
  });

  it("drops a fingerprint that is not 12 hex characters and a count that is not a small number", () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    logAllowlistLoaded(-1, "owner@example.test");
    logAllowlistLoaded(100_000, "ABCDEF123456");
    logAllowlistLoaded(Number.NaN, "short");
    for (const line of lines) {
      expect(JSON.parse(line)).toEqual({
        scope: "auth",
        event: "allowlist-loaded",
        entries: -1,
        malformed: 0,
        fingerprint: "invalid",
      });
      expect(line).not.toContain("owner");
    }
  });
});

describe("logAccountClosureProviderCall", () => {
  it("emits only a bounded Preview diagnostic", () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));

    logAccountClosureProviderCall(
      { outcome: "provider-rejected", status: 400, code: "INVALID_PASSWORD", elapsedMs: 17 },
      { VERCEL_ENV: "preview" },
    );

    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "account-closure-provider-call",
      stage: "delete-user",
      outcome: "provider-rejected",
      status: 400,
      code: "INVALID_PASSWORD",
      elapsedMs: 17,
    });
  });

  it.each([undefined, "production", "development"])(
    "emits nothing outside Preview: %s",
    (vercelEnv) => {
      const lines: string[] = [];
      setAuthLogSink((line) => lines.push(line));
      logAccountClosureProviderCall(
        { outcome: "early-error", elapsedMs: 1 },
        { VERCEL_ENV: vercelEnv },
      );
      expect(lines).toEqual([]);
    },
  );

  it("drops impossible status/timing and replaces a hostile code without serializing extra fields", () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    logAccountClosureProviderCall(
      {
        outcome: "provider-rejected",
        status: 999,
        code: "owner@example.test synthetic-password raw-token",
        elapsedMs: 900_000,
        body: { password: "synthetic-password" },
      } as never,
      { VERCEL_ENV: "preview" },
    );

    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "account-closure-provider-call",
      stage: "delete-user",
      outcome: "provider-rejected",
      code: "UNKNOWN",
    });
    expect(lines[0]).not.toContain("owner");
    expect(lines[0]).not.toContain("password");
    expect(lines[0]).not.toContain("token");
  });

  it("never changes account-closure behavior when the diagnostic sink fails", () => {
    setAuthLogSink(() => {
      throw new Error("synthetic logging failure");
    });

    expect(() =>
      logAccountClosureProviderCall(
        { outcome: "provider-rejected", status: 500, elapsedMs: 1 },
        { VERCEL_ENV: "preview" },
      ),
    ).not.toThrow();
  });
});
