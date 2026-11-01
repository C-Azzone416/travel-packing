// Usage (first job of the deploy workflow): node --experimental-strip-types scripts/release-gate.ts
// Reads EVENT_NAME, REF, SHA, ACTOR, TRIGGERING_ACTOR, REPO_OWNER and RELEASE_SHA from the environment (passed from the
// workflow's github context through `env:`, never interpolated into the shell), and writes `target=<...>` to GITHUB_OUTPUT.
import { appendFileSync } from "node:fs";
import { decideTarget } from "../src/tooling/release-gate.ts";

const decision = decideTarget(process.env);
if (!decision.ok) {
  console.error(`release gate: refused: ${decision.reason}`);
  process.exit(1);
}
console.log(`release gate: ok, this run deploys ${decision.target}`);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `target=${decision.target}\n`);
