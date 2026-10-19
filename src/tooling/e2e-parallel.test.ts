import { describe, expect, it } from "vitest";
import { E2E_PROJECTS, overallExitCode, planRuns, portsOf } from "./e2e-parallel";

describe("planRuns", () => {
  it("makes one run per project, each with its own output directory and project", () => {
    const runs = planRuns({}, false);
    expect(runs.map((run) => run.project)).toEqual([...E2E_PROJECTS]);
    expect(runs[0].args).toEqual(["--project", "phone", "--output", "test-results/phone"]);
    expect(runs[1].args).toEqual(["--project", "desktop", "--output", "test-results/desktop"]);
  });

  it("starts from the usual ports and moves the second run clear of the first", () => {
    const [phone, desktop] = planRuns({}, false);
    expect(phone.env).toEqual({ E2E_PORT: "3100", E2E_DB_PORT: "5433" });
    expect(desktop.env).toEqual({ E2E_PORT: "3400", E2E_DB_PORT: "5434" });
  });

  it("follows E2E_PORT and E2E_DB_PORT, and ignores junk", () => {
    expect(
      planRuns({ E2E_PORT: "3102", E2E_DB_PORT: "6000" }, false).map((run) => run.env),
    ).toEqual([
      { E2E_PORT: "3102", E2E_DB_PORT: "6000" },
      { E2E_PORT: "3402", E2E_DB_PORT: "6001" },
    ]);
    for (const junk of ["", "abc", "0", "-5", "70000", "3.5"]) {
      expect(planRuns({ E2E_PORT: junk, E2E_DB_PORT: junk }, false)[0].env).toEqual({
        E2E_PORT: "3100",
        E2E_DB_PORT: "5433",
      });
    }
  });

  it("never hands out the same port twice, for any starting port", () => {
    for (const start of [1, 80, 3100, 3102, 10000, 40000, 65000 - 700]) {
      const ports = portsOf(planRuns({ E2E_PORT: String(start) }, false));
      expect(new Set(ports).size).toBe(ports.length);
    }
  });

  it("refuses a starting port with no room for the second run", () => {
    expect(() => planRuns({ E2E_PORT: "65300" }, false)).toThrow(/too high/);
  });

  it("marks the runs as prebuilt only when asked, and passes extra arguments through", () => {
    expect(planRuns({}, false).some((run) => "E2E_PREBUILT" in run.env)).toBe(false);
    expect(planRuns({}, true).every((run) => run.env.E2E_PREBUILT === "1")).toBe(true);
    expect(planRuns({}, false, ["tests/e2e/smoke.spec.ts"])[0].args.at(-1)).toBe(
      "tests/e2e/smoke.spec.ts",
    );
  });
});

describe("overallExitCode", () => {
  it("is 0 only when every run exited 0", () => {
    expect(overallExitCode([0, 0])).toBe(0);
    expect(overallExitCode([0, 1])).toBe(1);
    expect(overallExitCode([2, 0])).toBe(1);
    expect(overallExitCode([null, 0])).toBe(1);
    expect(overallExitCode([0, undefined as unknown as number])).toBe(1);
  });
});
