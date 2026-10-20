import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ciChecks,
  formatSummary,
  runSteps,
  stepEnvironment,
  stepsFor,
  VERIFY_STEPS,
  verifyParityProblems,
  type Runner,
  type VerifyStep,
} from "./verify";

const ci = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

function fakeRunner(options: { missing?: string[]; failing?: string[] } = {}) {
  const ran: string[] = [];
  let now = 0;
  const runner: Runner = {
    has: (program) => !(options.missing ?? []).includes(program),
    run: (command) => {
      ran.push(command.join(" "));
      now += 2;
      return (options.failing ?? []).includes(command.join(" ")) ? 3 : 0;
    },
    clock: () => now,
  };
  return { runner, ran };
}

describe("the real step list and the real ci.yml", () => {
  it("run the same checks in the same order", () => {
    expect(verifyParityProblems(ci)).toEqual([]);
    expect(ciChecks(ci)).toEqual(VERIFY_STEPS.map((step) => step.id));
  });

  it("verify:quick is the cheap part: everything before the production builds, ending with the unit tests", () => {
    const quick = stepsFor("quick").map((step) => step.id);
    expect(quick.at(-1)).toBe("test:coverage");
    expect(quick).not.toContain("build");
    expect(quick).not.toContain("test:e2e");
    expect(stepsFor("full")).toHaveLength(VERIFY_STEPS.length);
  });

  it("e2e uses CI=1 and the shared port", () => {
    const e2e = VERIFY_STEPS.find((step) => step.id === "test:e2e");
    expect(e2e?.env).toEqual({ CI: "1", E2E_PORT: "3102", E2E_PREBUILT: "1" });
  });
});

describe("verifyParityProblems: each drift is caught", () => {
  const mutate = (from: string | RegExp, to: string) => {
    const out = ci.replace(from, to);
    expect(out).not.toBe(ci);
    return out;
  };

  it.each([
    [
      "a check added to ci.yml only",
      mutate(
        "      - name: Lint\n",
        "      - name: Extra\n        run: npm run extra-check\n\n      - name: Lint\n",
      ),
      /"extra-check" 1x but npm run verify runs it 0x/,
    ],
    [
      "a check removed from ci.yml",
      mutate(/ {6}- name: Typecheck\n {8}run: npm run typecheck\n\n/, ""),
      /"typecheck" 1x but ci.yml runs it 0x/,
    ],
    [
      "the audit removed from ci.yml",
      mutate("npm audit --omit=dev --audit-level=high", "true"),
      /"audit"/,
    ],
    [
      "gitleaks removed from ci.yml",
      mutate(/ {6}- uses: gitleaks[^\n]*\n {8}env:\n {10}GITHUB_TOKEN[^\n]*\n\n/, ""),
      /"gitleaks"/,
    ],
    [
      "actionlint removed from ci.yml",
      mutate('"$RUNNER_TEMP/actionlint" -color', "true"),
      /"actionlint"/,
    ],
    [
      "a build step added to ci.yml",
      mutate(
        "      - name: Scan the webpack client bundle\n",
        "      - name: Again\n        run: npm run build\n\n      - name: Scan the webpack client bundle\n",
      ),
      /"build" 2x/,
    ],
    [
      "the e2e step run twice",
      mutate(
        '        run: npm run test:e2e -- --project="$E2E_PROJECT"\n',
        '        run: npm run test:e2e -- --project="$E2E_PROJECT" && npm run test:e2e\n',
      ),
      /"test:e2e" 2x/,
    ],
    [
      "the e2e build dropped from ci.yml",
      mutate("        run: npm run build:e2e\n", "        run: true\n"),
      /"build:e2e" 1x but ci.yml runs it 0x/,
    ],
  ])("%s", (_name, workflow, message) => {
    expect(verifyParityProblems(workflow).join("\n")).toMatch(message);
  });

  it("ignores comments that mention commands", () => {
    expect(
      verifyParityProblems(
        mutate(
          "      - name: Lint\n",
          "      # npm run something-else and npm audit\n      - name: Lint\n",
        ),
      ),
    ).toEqual([]);
  });

  it("catches a different order", () => {
    const [first, second, ...rest] = VERIFY_STEPS;
    expect(verifyParityProblems(ci, [second, first, ...rest]).join("\n")).toMatch(
      /different order/,
    );
  });

  it("catches a step in verify that ci.yml lacks", () => {
    const extra: VerifyStep = {
      id: "extra",
      label: "Extra",
      command: ["npm", "run", "extra"],
      quick: true,
    };
    expect(verifyParityProblems(ci, [...VERIFY_STEPS, extra]).join("\n")).toMatch(
      /"extra" 1x but ci.yml runs it 0x/,
    );
  });

  it("catches a quick step after a full-only one", () => {
    const steps = VERIFY_STEPS.map((step) =>
      step.id === "test:e2e" ? { ...step, quick: true } : step,
    );
    expect(verifyParityProblems(ci, steps).join("\n")).toMatch(/prefix/);
  });

  it("catches a step whose command is not what its id says", () => {
    const steps = VERIFY_STEPS.map((step) =>
      step.id === "lint" ? { ...step, command: ["npm", "run", "format"] } : step,
    );
    expect(verifyParityProblems(ci, steps).join("\n")).toMatch(/"lint" does not run the command/);
    const audit = VERIFY_STEPS.map((step) =>
      step.id === "audit" ? { ...step, command: ["true"] } : step,
    );
    expect(verifyParityProblems(ci, audit).join("\n")).toMatch(/"audit" does not run/);
  });
});

describe("runSteps", () => {
  const steps = stepsFor("quick");

  it("runs every step in order when all pass, with the step's own env", () => {
    const { runner, ran } = fakeRunner({ missing: ["gitleaks", "actionlint"] });
    const results = runSteps(steps, runner);
    expect(results.filter((r) => r.status === "passed")).toHaveLength(steps.length - 2);
    expect(ran[0]).toBe("npm run check:repo-hygiene --silent");
    expect(results.every((r) => r.status !== "failed")).toBe(true);
  });

  it("reports a missing optional program as skipped, never as passed, and does not run it", () => {
    const { runner, ran } = fakeRunner({ missing: ["gitleaks"] });
    const results = runSteps(steps, runner);
    expect(results[0]).toMatchObject({
      status: "skipped",
      note: expect.stringContaining("gitleaks is not installed"),
    });
    expect(ran.some((command) => command.startsWith("gitleaks"))).toBe(false);
  });

  it("stops at the first failure and runs nothing after it", () => {
    const { runner, ran } = fakeRunner({ failing: ["npm run lint --silent"] });
    const results = runSteps(steps, runner);
    expect(results.at(-1)).toMatchObject({ status: "failed", note: "exit code 3" });
    expect(results.at(-1)?.step.id).toBe("lint");
    expect(ran.at(-1)).toBe("npm run lint --silent");
    expect(ran).not.toContain("npm run typecheck --silent");
  });

  it("measures seconds per step", () => {
    const { runner } = fakeRunner();
    expect(runSteps([VERIFY_STEPS[1]], runner)[0].seconds).toBe(2);
  });
});

describe("formatSummary", () => {
  const steps = stepsFor("quick");

  it("says OK on the head, listing each step", () => {
    const { runner } = fakeRunner();
    const text = formatSummary("quick", runSteps(steps, runner), "abc12345", steps.length);
    expect(text.split("\n")[0]).toBe("verify quick: OK on abc12345");
    expect(text).toContain("PASS  Lint (2s)");
  });

  it("names skipped steps in the verdict", () => {
    const { runner } = fakeRunner({ missing: ["gitleaks"] });
    const text = formatSummary("full", runSteps(steps, runner), "abc12345", steps.length);
    expect(text.split("\n")[0]).toBe("verify full: OK on abc12345 (1 skipped, see above)");
    expect(text).toContain("SKIP  Secret scan (gitleaks)");
  });

  it("says FAILED at the step and how many later steps did not run", () => {
    const { runner } = fakeRunner({
      missing: ["gitleaks", "actionlint"],
      failing: ["npm run lint --silent"],
    });
    const text = formatSummary(
      "quick",
      runSteps(steps, runner),
      "abc12345 (+ uncommitted changes)",
      steps.length,
    );
    expect(text.split("\n")[0]).toBe(
      'verify quick: FAILED at "Lint" on abc12345 (+ uncommitted changes)',
    );
    expect(text).toContain("FAIL  Lint: exit code 3");
    expect(text).toMatch(/2 later steps not run/);
  });

  it("uses the singular for one later step", () => {
    const two = steps.slice(-2);
    const { runner } = fakeRunner({ failing: ["npm run typecheck --silent"] });
    const text = formatSummary("quick", runSteps(two, runner), "h", two.length);
    expect(text).toContain("1 later step not run");
  });
});

describe("stepEnvironment", () => {
  it("lets a step's own environment act as defaults only", () => {
    expect(stepEnvironment({ CI: "1", E2E_PORT: "3102" }, { PATH: "/bin" })).toEqual({
      CI: "1",
      E2E_PORT: "3102",
      PATH: "/bin",
    });
  });

  it("lets the caller's environment win, so two verifies can run side by side on other ports", () => {
    expect(
      stepEnvironment(
        { CI: "1", E2E_PORT: "3102" },
        { E2E_PORT: "3199", E2E_DB_PORT: "5699", PATH: "/bin" },
      ),
    ).toEqual({ CI: "1", E2E_PORT: "3199", E2E_DB_PORT: "5699", PATH: "/bin" });
  });

  it("works for a step with no environment of its own", () => {
    expect(stepEnvironment(undefined, { A: "1" })).toEqual({ A: "1" });
  });

  it("is what the e2e step relies on: its default port is the CI one", () => {
    const e2e = stepsFor("full").find((step) => step.label.startsWith("E2E"));
    expect(e2e?.env).toEqual({ CI: "1", E2E_PORT: "3102", E2E_PREBUILT: "1" });
  });
});
