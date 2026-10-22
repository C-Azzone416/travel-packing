import { describe, expect, it } from "vitest";
import { ciVerdict, type CiRun } from "./ci-gate";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const run = (changes: Partial<CiRun> = {}): CiRun => ({
  status: "completed",
  conclusion: "success",
  headSha: SHA,
  createdAt: "2026-10-19T10:00:00Z",
  ...changes,
});

describe("ciVerdict", () => {
  it("passes for a completed successful run on exactly this commit", () => {
    expect(ciVerdict([run()], SHA)).toEqual({ ok: true });
  });

  it("ignores case and surrounding space in the commit", () => {
    expect(ciVerdict([run()], `  ${SHA.toUpperCase()}\n`)).toEqual({ ok: true });
  });

  it.each([
    ["a failure", { conclusion: "failure" }, /ended failure/],
    ["a cancellation", { conclusion: "cancelled" }, /ended cancelled/],
    ["a skip", { conclusion: "skipped" }, /ended skipped/],
    ["a timeout", { conclusion: "timed_out" }, /ended timed_out/],
    ["no result", { conclusion: null }, /without a result/],
    ["a run still going", { status: "in_progress", conclusion: null }, /still running/],
    ["a run still queued", { status: "queued", conclusion: null }, /still running/],
  ])("refuses %s", (_name, changes, message) => {
    const verdict = ciVerdict([run(changes)], SHA);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.reason).toMatch(message);
  });

  it("refuses a run on a different commit, and no runs at all", () => {
    expect(ciVerdict([run({ headSha: OTHER })], SHA)).toEqual({
      ok: false,
      reason: "CI has not run on this exact commit",
    });
    expect(ciVerdict([], SHA).ok).toBe(false);
  });

  it("refuses anything that is not a full SHA, so a short or empty one can never match", () => {
    for (const bad of ["", "abc123", SHA.slice(0, 39), `${SHA}0`, "not a sha"]) {
      const verdict = ciVerdict([run()], bad);
      expect(verdict.ok).toBe(false);
      expect(verdict.ok ? "" : verdict.reason).toMatch(/full 40-character SHA/);
    }
  });

  it("judges by the LATEST run on the commit: an old success does not rescue a newer failure, an old failure does not block a newer success", () => {
    const old = run({ createdAt: "2026-10-19T09:00:00Z" });
    const newer = run({ createdAt: "2026-10-19T11:00:00Z" });
    expect(ciVerdict([old, { ...newer, conclusion: "failure" }], SHA).ok).toBe(false);
    expect(ciVerdict([{ ...old, conclusion: "failure" }, newer], SHA).ok).toBe(true);
    expect(ciVerdict([newer, old], SHA).ok).toBe(true);
  });

  it("a newer run that has not finished blocks, whatever an older run said", () => {
    expect(
      ciVerdict(
        [
          run(),
          run({ createdAt: "2026-10-19T12:00:00Z", status: "in_progress", conclusion: null }),
        ],
        SHA,
      ).ok,
    ).toBe(false);
  });

  it("only other commits' runs never count, even if successful and newer", () => {
    expect(
      ciVerdict(
        [
          run({ createdAt: "2026-10-19T08:00:00Z", conclusion: "failure" }),
          run({ headSha: OTHER, createdAt: "2026-10-19T13:00:00Z" }),
        ],
        SHA,
      ).ok,
    ).toBe(false);
  });
});
