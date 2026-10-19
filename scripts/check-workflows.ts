// Usage: tsx scripts/check-workflows.ts   (from the repository root; CI runs it next to actionlint)
// Every workflow's actions must be pinned to a full SHA, and the deploy workflow must keep its safety contract.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDeployWorkflow, unpinnedActions } from "../src/tooling/workflow-check";

const dir = join(".github", "workflows");
let failed = false;
for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
  const text = readFileSync(join(dir, file), "utf8");
  const problems = [
    ...unpinnedActions(text),
    ...(file === "deploy-vercel.yml" ? checkDeployWorkflow(text) : []),
  ];
  for (const problem of problems) console.error(`${file}: ${problem}`);
  if (problems.length) failed = true;
  else console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);
