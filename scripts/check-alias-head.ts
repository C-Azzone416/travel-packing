// Usage: tsx scripts/check-alias-head.ts <this run's commit SHA> <the develop head SHA>
// Writes `assign=true` or `assign=false` to GITHUB_OUTPUT and says why. Exits 1 (loudly, alias untouched) if either SHA is unreadable.
import { appendFileSync } from "node:fs";
import { aliasDecision } from "../src/tooling/alias-head";

const [runSha, head] = process.argv.slice(2);
try {
  const decision = aliasDecision(runSha, head);
  console.log(`${decision.assign ? "alias: ok" : "::notice::alias skipped"}: ${decision.reason}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `assign=${decision.assign}\n`);
} catch (error) {
  console.error(`alias: ${error instanceof Error ? error.message : "the head check failed"}`);
  process.exit(1);
}
