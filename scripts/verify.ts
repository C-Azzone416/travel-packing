// Usage: tsx scripts/verify.ts [--quick]   (npm run verify / npm run verify:quick)
// Runs the checks the full-mode `ci` job runs (src/tooling/verify.ts), stops at the first failure and prints a summary
// that can be pasted into a pull request. In addition to CI, never instead of it.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  VERIFY_STEPS,
  failedTestSummary,
  formatSummary,
  runSteps,
  stepEnvironment,
  stepsFor,
  type Mode,
  type Runner,
} from "../src/tooling/verify";

const mode: Mode = process.argv.includes("--quick") ? "quick" : "full";

const runner: Runner = {
  has(program) {
    const probe = process.platform === "win32" ? "where" : "which";
    return spawnSync(probe, [program], { stdio: "ignore" }).status === 0;
  },
  run(command, env) {
    const [file, ...args] = command;
    console.log(`\n> ${command.join(" ")}`);
    // A stale report from an earlier run must never be read as this run's failure.
    mkdirSync(".verify-logs", { recursive: true });
    const step = VERIFY_STEPS.find((entry) => entry.command.join(" ") === command.join(" "));
    if (step?.failureReport) {
      rmSync(step.failureReport, { force: true });
      rmSync(`${step.failureReport}.log`, { force: true });
      // This step's whole output is kept too: a coverage-threshold failure names no test, only a line near the end.
      const result = spawnSync(file, args, {
        stdio: ["inherit", "pipe", "pipe"],
        env: stepEnvironment(env, process.env),
        maxBuffer: 256 * 1024 * 1024,
      });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      writeFileSync(`${step.failureReport}.log`, `${result.stdout}${result.stderr}`);
      return result.status ?? 1;
    }
    return (
      spawnSync(file, args, { stdio: "inherit", env: stepEnvironment(env, process.env) }).status ??
      1
    );
  },
  clock: () => Date.now() / 1000,
};

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
const dirty = git(["status", "--porcelain", "--untracked-files=no"])
  ? " (+ uncommitted changes)"
  : "";
const head = `${git(["rev-parse", "--short=8", "HEAD"]) || "unknown"}${dirty}`;

const steps = stepsFor(mode);
const results = runSteps(steps, runner);
const failedStep = results.find((result) => result.status === "failed")?.step;
if (failedStep?.failureReport) {
  try {
    const failures = failedTestSummary(readFileSync(failedStep.failureReport, "utf8"));
    if (failures.length)
      console.log(
        `\nFailed tests (report kept at ${failedStep.failureReport}):\n${failures.join("\n")}`,
      );
  } catch {
    console.log(`\n(no test report at ${failedStep.failureReport})`);
  }
}
console.log(`\n${"=".repeat(60)}\n${formatSummary(mode, results, head, steps.length)}`);
process.exit(results.some((result) => result.status === "failed") ? 1 : 0);
