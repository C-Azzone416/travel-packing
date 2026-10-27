import { describe, expect, it, vi } from "vitest";
import { logFeedbackUpstream } from "./safe-log";

describe("logFeedbackUpstream", () => {
  it("emits exactly the closed diagnostic schema and clamps numeric fields", () => {
    const lines: string[] = [];
    logFeedbackUpstream(
      {
        phase: "media",
        outcome: "refused",
        elapsedMs: 99_999,
        status: 401,
        note: "must not escape",
        credential: "must not escape",
      } as never,
      (line) => lines.push(line),
    );
    expect(JSON.parse(lines[0])).toEqual({
      scope: "feedback",
      event: "framebriar_upstream",
      phase: "media",
      outcome: "refused",
      elapsedMs: 60_000,
      status: 401,
    });
  });

  it.each([99, 600, 200.5, Number.NaN])("drops impossible status %s", (status) => {
    const lines: string[] = [];
    logFeedbackUpstream(
      { phase: "metadata", outcome: "invalid-response", elapsedMs: Number.NaN, status },
      (line) => lines.push(line),
    );
    expect(JSON.parse(lines[0])).toEqual({
      scope: "feedback",
      event: "framebriar_upstream",
      phase: "metadata",
      outcome: "invalid-response",
      elapsedMs: 0,
    });
  });

  it("uses console.info by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logFeedbackUpstream({ phase: "metadata", outcome: "ok", elapsedMs: 4, status: 200 });
    expect(info).toHaveBeenCalledWith(
      '{"scope":"feedback","event":"framebriar_upstream","phase":"metadata","outcome":"ok","elapsedMs":4,"status":200}',
    );
    info.mockRestore();
  });
});
