import { afterEach, describe, expect, it, vi } from "vitest";
import { logAuthEvent, setAuthLogSink } from "./safe-log";

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
