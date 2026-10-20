// Usage: tsx scripts/verify.ts [--quick]   (npm run verify / npm run verify:quick)
// Runs the checks the full-mode `ci` job runs (src/tooling/verify.ts), stops at the first failure and prints a summary
// that can be pasted into a pull request. In addition to CI, never instead of it.
import { spawnSync } from "node:child_process";
import {
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
console.log(`\n${"=".repeat(60)}\n${formatSummary(mode, results, head, steps.length)}`);
process.exit(results.some((result) => result.status === "failed") ? 1 : 0);
