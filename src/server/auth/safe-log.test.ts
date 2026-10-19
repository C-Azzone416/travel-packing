import { afterEach, describe, expect, it, vi } from "vitest";
import { logAllowlistLoaded, logAuthEvent, setAuthLogSink } from "./safe-log";

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

  it.each([
    ["a message with an address", "Email owner@example.test is taken"],
    ["lower-case words with spaces", "something went wrong"],
    ["too long", "A".repeat(80)],
    ["too short", "AB"],
    ["an empty code", ""],
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
