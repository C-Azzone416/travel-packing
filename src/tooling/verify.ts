// `npm run verify` (#95): the checks the full-mode `ci` job runs, in the same cheapest-first order, run locally so a red CI
// run is not how a lint error is found. The step list is the single source; `verifyParityProblems` fails when ci.yml and
// this list drift apart (a check added to one but not the other).

export interface VerifyStep {
  /** Matches the id `ciChecks` derives from ci.yml: the npm script name, `audit`, `gitleaks` or `actionlint`. */
  id: string;
  label: string;
  command: string[];
  /** Part of `verify:quick` (everything before the production builds). */
  quick: boolean;
  /** Run only when this program is installed; otherwise the step is reported as skipped, never as passed. */
  needs?: string;
  env?: Record<string, string>;
  /** A JSON test report this step writes; when the step fails, the failed tests in it are printed (#150). */
  failureReport?: string;
}

export const UNIT_REPORT = ".verify-logs/unit.json";

const npm = (script: string): string[] => ["npm", "run", script, "--silent"];

export const VERIFY_STEPS: readonly VerifyStep[] = [
  {
    id: "gitleaks",
    label: "Secret scan (gitleaks)",
    command: ["gitleaks", "detect", "--no-banner", "--redact"],
    quick: true,
    needs: "gitleaks",
  },
  {
    id: "check:repo-hygiene",
    label: "Repository hygiene",
    command: npm("check:repo-hygiene"),
    quick: true,
  },
  {
    id: "actionlint",
    label: "Workflow syntax (actionlint)",
    command: ["actionlint"],
    quick: true,
    needs: "actionlint",
  },
  {
    id: "check:workflows",
    label: "Workflow contract",
    command: npm("check:workflows"),
    quick: true,
  },
  {
    id: "audit",
    label: "Dependency audit",
    command: ["npm", "audit", "--omit=dev", "--audit-level=high"],
    quick: true,
  },
  { id: "lint", label: "Lint", command: npm("lint"), quick: true },
  { id: "typecheck", label: "Typecheck", command: npm("typecheck"), quick: true },
  {
    id: "test:coverage",
    label: "Unit tests with the 90% coverage gate",
    // The JSON report is kept so a one-off failure under load names its test instead of scrolling away (#150).
    command: [
      ...npm("test:coverage"),
      "--",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${UNIT_REPORT}`,
    ],
    quick: true,
    failureReport: UNIT_REPORT,
  },
  {
    id: "build:production",
    label: "Production build",
    command: npm("build:production"),
    quick: false,
  },
  {
    id: "check:no-e2e-in-build",
    label: "No e2e code in the build",
    command: npm("check:no-e2e-in-build"),
    quick: false,
  },
  {
    id: "check:no-capture-in-build",
    label: "No screenshot capture in the production build",
    command: npm("check:no-capture-in-build"),
    quick: false,
  },
  {
    id: "check:no-feedback-in-build",
    label: "No Preview feedback in the production build",
    command: npm("check:no-feedback-in-build"),
    quick: false,
  },
  {
    id: "check:client-bundle",
    label: "Client bundle scan",
    command: npm("check:client-bundle"),
    quick: false,
  },
  { id: "build:webpack", label: "Webpack build", command: npm("build:webpack"), quick: false },
  {
    id: "check:no-e2e-in-build",
    label: "No e2e code in the webpack build",
    command: npm("check:no-e2e-in-build"),
    quick: false,
  },
  {
    id: "check:no-capture-in-build",
    label: "No screenshot capture in the webpack build",
    command: npm("check:no-capture-in-build"),
    quick: false,
  },
  {
    id: "check:no-feedback-in-build",
    label: "No Preview feedback in the webpack build",
    command: npm("check:no-feedback-in-build"),
    quick: false,
  },
  {
    id: "check:client-bundle",
    label: "Webpack client bundle scan",
    command: npm("check:client-bundle"),
    quick: false,
  },
  // CI builds the e2e variant once and hands it to the phone and desktop jobs; locally the same two steps run in order.
  {
    id: "build:e2e",
    label: "Build for e2e",
    command: npm("build:e2e"),
    quick: false,
  },
  {
    id: "test:e2e",
    label: "E2E (phone + desktop)",
    command: npm("test:e2e"),
    quick: false,
    env: { CI: "1", E2E_PORT: "3102", E2E_PREBUILT: "1" },
  },
];

/**
 * A step's own environment (CI=1, E2E_PORT=3102 for the e2e step, so it matches CI) acts as DEFAULTS: anything already set in the
 * caller's environment wins. That way two verifies on one machine can use different ports
 * (`E2E_PORT=3199 E2E_DB_PORT=5699 npm run verify`) instead of colliding.
 */
export function stepEnvironment(
  stepEnv: Record<string, string> | undefined,
  processEnv: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return { ...stepEnv, ...processEnv } as NodeJS.ProcessEnv;
}

export type Mode = "quick" | "full";

export function stepsFor(mode: Mode, steps: readonly VerifyStep[] = VERIFY_STEPS): VerifyStep[] {
  return steps.filter((step) => mode === "full" || step.quick);
}

export interface StepResult {
  step: VerifyStep;
  status: "passed" | "failed" | "skipped";
  seconds: number;
  note?: string;
}

export interface Runner {
  /** True when the program exists on this machine. */
  has(program: string): boolean;
  /** Runs the command with its output shown; resolves to the exit code. */
  run(command: string[], env: Record<string, string>): number;
  /** Seconds since some fixed point. */
  clock(): number;
}

/** Runs the steps in order and stops at the first failure. Steps after a failure are not run (and not listed as passed). */
export function runSteps(steps: readonly VerifyStep[], runner: Runner): StepResult[] {
  const results: StepResult[] = [];
  for (const step of steps) {
    if (step.needs && !runner.has(step.needs)) {
      results.push({
        step,
        status: "skipped",
        seconds: 0,
        note: `${step.needs} is not installed here (CI still runs it)`,
      });
      continue;
    }
    const started = runner.clock();
    const code = runner.run(step.command, step.env ?? {});
    const seconds = Math.round(runner.clock() - started);
    if (code === 0) {
      results.push({ step, status: "passed", seconds });
    } else {
      results.push({ step, status: "failed", seconds, note: `exit code ${code}` });
      break;
    }
  }
  return results;
}

/** The short, pasteable summary for a PR or #reviews. Names the head so it cannot be pasted for another commit. */
export function formatSummary(
  mode: Mode,
  results: readonly StepResult[],
  head: string,
  planned: number,
): string {
  const failed = results.find((result) => result.status === "failed");
  const mark = { passed: "PASS", failed: "FAIL", skipped: "SKIP" } as const;
  const lines = results.map(
    (result) =>
      `${mark[result.status]}  ${result.step.label}${result.status === "passed" ? ` (${result.seconds}s)` : ""}${result.note ? `: ${result.note}` : ""}`,
  );
  const notRun = planned - results.length;
  if (failed && notRun > 0)
    lines.push(`      ${notRun} later step${notRun === 1 ? "" : "s"} not run`);
  const skipped = results.filter((result) => result.status === "skipped").length;
  const verdict = failed
    ? `verify ${mode}: FAILED at "${failed.step.label}" on ${head}`
    : `verify ${mode}: OK on ${head}${skipped ? ` (${skipped} skipped, see above)` : ""}`;
  return [verdict, ...lines].join("\n");
}

/**
 * The checks a `ci` job runs, in order, as ids: gitleaks, actionlint, `npm run <script>` and `npm audit`. Comment lines
 * are ignored, and so are steps that only install, decide the mode, summarise or upload.
 */
export function ciChecks(ci: string): string[] {
  const ids: string[] = [];
  const steps = ci.split(/^(?= {6}- )/m).filter((chunk) => /^ {6}- /.test(chunk));
  for (const step of steps) {
    const code = step
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    if (/uses:\s*gitleaks\/gitleaks-action@/.test(code)) ids.push("gitleaks");
    if (/^\s*"?\$RUNNER_TEMP\/actionlint"?(\s|$)/m.test(code)) ids.push("actionlint");
    for (const match of code.matchAll(/npm (?:run ([\w:.-]+)|(audit)\b)/g))
      ids.push(match[1] ?? "audit");
  }
  return ids;
}

/** Empty when `verify` (full) and the ci job run the same checks in the same order, and quick is a prefix of full. */
export function verifyParityProblems(
  ci: string,
  steps: readonly VerifyStep[] = VERIFY_STEPS,
): string[] {
  const problems: string[] = [];
  const inCi = ciChecks(ci);
  const inVerify = steps.map((step) => step.id);
  for (const id of new Set([...inCi, ...inVerify])) {
    const a = inCi.filter((x) => x === id).length;
    const b = inVerify.filter((x) => x === id).length;
    if (a > b) problems.push(`ci.yml runs "${id}" ${a}x but npm run verify runs it ${b}x`);
    if (b > a) problems.push(`npm run verify runs "${id}" ${b}x but ci.yml runs it ${a}x`);
  }
  if (!problems.length && inCi.join() !== inVerify.join()) {
    problems.push("ci.yml and npm run verify run the same checks in a different order");
  }
  const firstFull = steps.findIndex((step) => !step.quick);
  if (steps.slice(firstFull).some((step) => step.quick)) {
    problems.push(
      "verify:quick must be a prefix of verify (every quick step before the first full-only one)",
    );
  }
  for (const step of steps) {
    const expected =
      step.id === "audit"
        ? ["npm", "audit"]
        : step.command[0] === "npm"
          ? ["npm", "run", step.id]
          : null;
    if (expected && !expected.every((word, i) => step.command[i] === word)) {
      problems.push(`the verify step "${step.id}" does not run the command its id names`);
    }
  }
  return problems;
}

/** The project names a Playwright config declares (`{ name: "phone", ... }` entries under `projects`). */
export function playwrightProjects(config: string): string[] {
  const start = config.indexOf("projects:");
  if (start < 0) return [];
  return [...config.slice(start).matchAll(/\bname:\s*"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);
}

/** The projects the CI e2e matrix runs (`- project: phone`). */
export function ciE2eProjects(ci: string): string[] {
  return [...ci.matchAll(/^ {10}- project:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/**
 * Empty when every Playwright project runs in CI and the other way round. `npm run verify` runs `npm run test:e2e` with no
 * project filter, so it runs them all; this ties CI to the same list, so a project added to the config can never be skipped by CI
 * (or by the local verify) without a failing check.
 */
export function e2eProjectParityProblems(config: string, ci: string): string[] {
  const inConfig = playwrightProjects(config);
  const inCi = ciE2eProjects(ci);
  const problems: string[] = [];
  for (const name of inConfig)
    if (!inCi.includes(name)) problems.push(`the Playwright project "${name}" does not run in CI`);
  for (const name of inCi)
    if (!inConfig.includes(name))
      problems.push(`CI runs the project "${name}", which playwright.config.ts does not declare`);
  if (inConfig.length === 0) problems.push("no Playwright projects found in playwright.config.ts");
  return problems;
}

interface VitestJsonReport {
  testResults?: {
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: { fullName?: string; status?: string; failureMessages?: string[] }[];
  }[];
}

const FIRST_LINES = 6;
const MAX_FAILURES = 20;

/**
 * The failed tests in a vitest JSON report: file, full test name and the first lines of the message. A file that
 * failed before any test ran (an import error, a hook timeout) is listed as such. Empty for a clean or unreadable report.
 */
export function failedTestSummary(reportText: string): string[] {
  let report: VitestJsonReport;
  try {
    report = JSON.parse(reportText) as VitestJsonReport;
  } catch {
    return [];
  }
  const lines: string[] = [];
  let count = 0;
  for (const file of report.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    if (failed.length === 0 && file.status === "failed") {
      count++;
      if (count <= MAX_FAILURES)
        lines.push(
          `FAILED FILE ${file.name ?? "(unknown)"}`,
          ...(file.message ?? "")
            .split("\n")
            .slice(0, FIRST_LINES)
            .map((line) => `    ${line}`),
        );
    }
    for (const test of failed) {
      count++;
      if (count > MAX_FAILURES) continue;
      lines.push(
        `FAILED ${file.name ?? "(unknown)"} > ${test.fullName ?? "(unnamed test)"}`,
        ...(test.failureMessages?.[0] ?? "")
          .split("\n")
          .slice(0, FIRST_LINES)
          .map((line) => `    ${line}`),
      );
    }
  }
  if (count > MAX_FAILURES) lines.push(`... and ${count - MAX_FAILURES} more`);
  return lines;
}

// ---------------------------------------------------------------- how the unit step ended (#150)
// The unit step once died after every test file had passed, with no summary, no coverage table and no JSON report. A
// test name cannot explain that, so the step's exit is recorded instead: the exit code and signal, which stage it
// reached, how many files it reported against how many exist, the tail of what it wrote, and the machine's load and
// memory at that moment. Instrumentation only: nothing here changes how the tests run.

/** How far a vitest run got, judged from its own output and whether the JSON report exists. */
export type UnitStage =
  "no-output" | "running-tests" | "tests-finished" | "coverage-reported" | "report-written";

/** Lines vitest prints for each finished test file: a pass (✓), a failure (❯ or ×) or a skipped file (↓). */
const FILE_LINE = /^\s*(?:✓|❯|×|↓)\s+\S+\.test\.tsx?\b/;

/** The number of test files vitest printed a result line for. */
export function testFilesReported(output: string): number {
  return output.split("\n").filter((line) => FILE_LINE.test(line)).length;
}

export function unitStage(output: string, reportWritten: boolean): UnitStage {
  if (reportWritten) return "report-written";
  if (/Coverage summary|% Stmts/.test(output)) return "coverage-reported";
  if (/^\s*Test Files\s+\d+/m.test(output)) return "tests-finished";
  return testFilesReported(output) > 0 ? "running-tests" : "no-output";
}

export interface UnitExitInput {
  exitCode: number | null;
  signal: string | null;
  /** The spawn error, when the process could not run or its output overflowed. */
  error?: string;
  stdout: string;
  stderr: string;
  reportWritten: boolean;
  testFilesExpected: number;
  seconds: number;
  loadAverage: readonly number[];
  freeMemoryMb: number;
  totalMemoryMb: number;
  node: string;
}

export interface UnitExitRecord {
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stage: UnitStage;
  testFilesReported: number;
  testFilesExpected: number;
  seconds: number;
  stdoutBytes: number;
  stderrBytes: number;
  stderrTail: string[];
  stdoutTail: string[];
  loadAverage: number[];
  freeMemoryMb: number;
  totalMemoryMb: number;
  node: string;
}

const tail = (text: string, count: number): string[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-count);

export function buildUnitExitRecord(input: UnitExitInput): UnitExitRecord {
  return {
    exitCode: input.exitCode,
    signal: input.signal,
    error: input.error ?? null,
    stage: unitStage(input.stdout, input.reportWritten),
    testFilesReported: testFilesReported(input.stdout),
    testFilesExpected: input.testFilesExpected,
    seconds: Math.round(input.seconds),
    stdoutBytes: Buffer.byteLength(input.stdout),
    stderrBytes: Buffer.byteLength(input.stderr),
    stderrTail: tail(input.stderr, 15),
    stdoutTail: tail(input.stdout, 10),
    loadAverage: input.loadAverage.map((value) => Math.round(value * 100) / 100),
    freeMemoryMb: Math.round(input.freeMemoryMb),
    totalMemoryMb: Math.round(input.totalMemoryMb),
    node: input.node,
  };
}

const STAGE_TEXT: Record<UnitStage, string> = {
  "no-output": "before any test file finished",
  "running-tests": "while test files were still being reported (no summary was printed)",
  "tests-finished": "after the test summary, before coverage was reported",
  "coverage-reported": "after the coverage report, before the JSON report was written",
  "report-written": "after the JSON report was written",
};

/** The lines the verify summary prints when the unit step fails: what happened, in words, then the evidence. */
export function describeUnitExit(record: UnitExitRecord): string[] {
  const ended = record.signal
    ? `was killed by signal ${record.signal}`
    : `exited with code ${record.exitCode ?? "none"}`;
  const lines = [
    `The unit step ${ended}${record.error ? ` (${record.error})` : ""}, ${STAGE_TEXT[record.stage]}.`,
    `${record.testFilesReported} of ${record.testFilesExpected} test files had printed a result; it ran ${record.seconds}s, wrote ${record.stdoutBytes} bytes to stdout and ${record.stderrBytes} to stderr.`,
    `Machine at the end: load ${record.loadAverage.join(" / ")}, ${record.freeMemoryMb} MB free of ${record.totalMemoryMb} MB, node ${record.node}.`,
  ];
  if (record.stderrTail.length)
    lines.push("Last stderr lines:", ...record.stderrTail.map((line) => `    ${line}`));
  return lines;
}
