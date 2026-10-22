import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildUnitExitRecord,
  describeUnitExit,
  failedTestSummary,
  testFilesReported,
  unitStage,
  ciChecks,
  ciE2eProjects,
  e2eProjectParityProblems,
  playwrightProjects,
  formatSummary,
  runSteps,
  stepEnvironment,
  stepsFor,
  UNIT_REPORT,
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

describe("e2e project parity", () => {
  const config = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");

  it("the real Playwright projects are the real CI matrix", () => {
    expect(playwrightProjects(config)).toEqual(["phone", "desktop"]);
    expect(ciE2eProjects(ci)).toEqual(["phone", "desktop"]);
    expect(e2eProjectParityProblems(config, ci)).toEqual([]);
  });

  it("flags a project CI would never run", () => {
    const extra = config.replace(
      '{ name: "desktop"',
      '{ name: "tablet", use: {} },\n    { name: "desktop"',
    );
    expect(extra).not.toBe(config);
    expect(e2eProjectParityProblems(extra, ci).join("\n")).toMatch(/"tablet" does not run in CI/);
  });

  it("flags a CI project the config does not have", () => {
    const renamed = config.replace('name: "phone"', 'name: "mobile"');
    expect(renamed).not.toBe(config);
    const problems = e2eProjectParityProblems(renamed, ci).join("\n");
    expect(problems).toMatch(/"mobile" does not run in CI/);
    expect(problems).toMatch(/CI runs the project "phone"/);
  });

  it("flags a config with no projects", () => {
    expect(e2eProjectParityProblems("export default {};", ci).join("\n")).toMatch(
      /no Playwright projects/,
    );
  });
});

describe("failedTestSummary (#150)", () => {
  const report = (testResults: unknown[]) => JSON.stringify({ testResults });

  it("names the file, the full test name and the first lines of the message for each failure", () => {
    const lines = failedTestSummary(
      report([
        {
          name: "/repo/src/a.test.ts",
          status: "failed",
          assertionResults: [
            { fullName: "a > passes", status: "passed", failureMessages: [] },
            {
              fullName: "a > times out",
              status: "failed",
              failureMessages: ["Error: timed out\n  at one\n  at two"],
            },
          ],
        },
      ]),
    );
    expect(lines).toEqual([
      "FAILED /repo/src/a.test.ts > a > times out",
      "    Error: timed out",
      "      at one",
      "      at two",
    ]);
  });

  it("lists a file that failed before any test ran", () => {
    expect(
      failedTestSummary(
        report([
          {
            name: "/repo/src/b.test.ts",
            status: "failed",
            message: "Hook timed out",
            assertionResults: [],
          },
        ]),
      ),
    ).toEqual(["FAILED FILE /repo/src/b.test.ts", "    Hook timed out"]);
  });

  it("is empty for a clean report, garbage and a missing field", () => {
    expect(
      failedTestSummary(
        report([{ name: "c", status: "passed", assertionResults: [{ status: "passed" }] }]),
      ),
    ).toEqual([]);
    expect(failedTestSummary("not json")).toEqual([]);
    expect(failedTestSummary("{}")).toEqual([]);
  });

  it("caps a long list and says how many more there were", () => {
    const many = Array.from({ length: 25 }, (_, at) => ({
      fullName: `t${at}`,
      status: "failed",
      failureMessages: ["boom"],
    }));
    const lines = failedTestSummary(
      report([{ name: "d", status: "failed", assertionResults: many }]),
    );
    expect(lines.filter((line) => line.startsWith("FAILED"))).toHaveLength(20);
    expect(lines.at(-1)).toBe("... and 5 more");
  });
});

describe("the unit step keeps a report", () => {
  it("writes a JSON report that scripts/verify.ts reads back when the step fails", () => {
    const step = VERIFY_STEPS.find((entry) => entry.id === "test:coverage");
    expect(step?.failureReport).toBe(UNIT_REPORT);
    expect(step?.command).toContain(`--outputFile.json=${UNIT_REPORT}`);
    expect(step?.command).toContain("--reporter=json");
    expect(step?.command).toContain("--reporter=default");
  });
});

describe("how the unit step ended (#150)", () => {
  const passing = [
    " ✓ src/domain/a.test.ts (3 tests) 5ms",
    " ✓ src/features/b.test.tsx (4 tests) 40ms",
    " ❯ src/features/c.test.tsx (2 tests | 1 failed) 8ms",
    " ↓ src/features/d.test.ts (skipped)",
    "stdout | src/features/b.test.tsx > a thing",
    "some log line",
  ].join("\n");
  const summary = ["", " Test Files  3 passed (3)", "      Tests  9 passed (9)"].join("\n");
  const coverage = ["----|---- % Stmts | % Branch", "Coverage summary", "Statements   : 99%"].join(
    "\n",
  );

  it("counts the test files that printed a result line, whatever the result", () => {
    expect(testFilesReported(passing)).toBe(4);
    expect(testFilesReported("no result lines here\nsrc/not/a.test.ts mentioned in prose")).toBe(0);
    expect(testFilesReported("")).toBe(0);
  });

  it("names how far the run got from its output and the report file", () => {
    expect(unitStage("", false)).toBe("no-output");
    expect(unitStage("Vite warning only", false)).toBe("no-output");
    expect(unitStage(passing, false)).toBe("running-tests");
    expect(unitStage(`${passing}\n${summary}`, false)).toBe("tests-finished");
    expect(unitStage(`${passing}\n${summary}\n${coverage}`, false)).toBe("coverage-reported");
    expect(unitStage(`${passing}\n${summary}\n${coverage}`, true)).toBe("report-written");
    // The report on disk wins even if the output was cut short.
    expect(unitStage(passing, true)).toBe("report-written");
  });

  const base = {
    exitCode: 1,
    signal: null,
    stdout: passing,
    stderr: "line one\n\nline two\n",
    reportWritten: false,
    testFilesExpected: 4,
    seconds: 41.6,
    loadAverage: [4.123, 3.987, 3.5],
    freeMemoryMb: 1234.7,
    totalMemoryMb: 16384,
    node: "v26.9.0",
  };

  it("records the exit, the stage, the file counts, the tails and the machine, rounded", () => {
    const record = buildUnitExitRecord(base);
    expect(record).toMatchObject({
      exitCode: 1,
      signal: null,
      error: null,
      stage: "running-tests",
      testFilesReported: 4,
      testFilesExpected: 4,
      seconds: 42,
      stderrTail: ["line one", "line two"],
      loadAverage: [4.12, 3.99, 3.5],
      freeMemoryMb: 1235,
      totalMemoryMb: 16384,
      node: "v26.9.0",
    });
    expect(record.stdoutBytes).toBe(Buffer.byteLength(passing));
    expect(record.stderrBytes).toBe(Buffer.byteLength(base.stderr));
    expect(record.stdoutTail.at(-1)).toBe("some log line");
  });

  it("keeps only the last lines of a long tail, and records a spawn error and a signal", () => {
    const long = Array.from({ length: 40 }, (_, at) => `err ${at}`).join("\n");
    const record = buildUnitExitRecord({
      ...base,
      stderr: long,
      exitCode: null,
      signal: "SIGKILL",
      error: "spawnSync ENOBUFS",
    });
    expect(record.stderrTail).toHaveLength(15);
    expect(record.stderrTail[0]).toBe("err 25");
    expect(record).toMatchObject({ exitCode: null, signal: "SIGKILL", error: "spawnSync ENOBUFS" });
  });

  it("says in words that the step died after the tests with no summary, the case #150 captured", () => {
    const lines = describeUnitExit(buildUnitExitRecord({ ...base, testFilesExpected: 4 }));
    expect(lines[0]).toBe(
      "The unit step exited with code 1, while test files were still being reported (no summary was printed).",
    );
    expect(lines[1]).toMatch(
      /^4 of 4 test files had printed a result; it ran 42s, wrote \d+ bytes to stdout and \d+ to stderr\.$/,
    );
    expect(lines[2]).toBe(
      "Machine at the end: load 4.12 / 3.99 / 3.5, 1235 MB free of 16384 MB, node v26.9.0.",
    );
    expect(lines.slice(3)).toEqual(["Last stderr lines:", "    line one", "    line two"]);
  });

  it("names a signal and a spawn error, each stage, and leaves out an empty stderr tail", () => {
    const killed = describeUnitExit(
      buildUnitExitRecord({
        ...base,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: "SIGSEGV",
        error: "boom",
      }),
    );
    expect(killed[0]).toBe(
      "The unit step was killed by signal SIGSEGV (boom), before any test file finished.",
    );
    expect(killed).toHaveLength(3);
    const stages = [
      [`${passing}\n${summary}`, "after the test summary, before coverage was reported"],
      [
        `${passing}\n${summary}\n${coverage}`,
        "after the coverage report, before the JSON report was written",
      ],
    ] as const;
    for (const [stdout, words] of stages)
      expect(describeUnitExit(buildUnitExitRecord({ ...base, stdout }))[0]).toContain(words);
    expect(describeUnitExit(buildUnitExitRecord({ ...base, reportWritten: true }))[0]).toContain(
      "after the JSON report was written",
    );
    expect(
      describeUnitExit(buildUnitExitRecord({ ...base, exitCode: null, signal: null }))[0],
    ).toContain("exited with code none");
  });
});
