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
}

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
    command: npm("test:coverage"),
    quick: true,
  },
  { id: "build", label: "Production build", command: npm("build"), quick: false },
  {
    id: "check:no-e2e-in-build",
    label: "No e2e code in the build",
    command: npm("check:no-e2e-in-build"),
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
    id: "check:client-bundle",
    label: "Webpack client bundle scan",
    command: npm("check:client-bundle"),
    quick: false,
  },
  {
    id: "test:e2e",
    label: "E2E (phone + desktop)",
    command: npm("test:e2e"),
    quick: false,
    env: { CI: "1", E2E_PORT: "3102" },
  },
];

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
