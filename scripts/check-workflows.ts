// Usage: tsx scripts/check-workflows.ts   (from the repository root; CI runs it next to actionlint)
// Every workflow's actions must be pinned to a full SHA, the deploy workflow must keep its safety contract, and ci.yml
// must run the same checks as `npm run verify`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkCiWorkflow,
  checkDeployWorkflow,
  unpinnedActions,
} from "../src/tooling/workflow-check";
import { e2eProjectParityProblems, verifyParityProblems } from "../src/tooling/verify";

const dir = join(".github", "workflows");
let failed = false;
for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
  const text = readFileSync(join(dir, file), "utf8");
  const problems = [
    ...unpinnedActions(text),
    ...(file === "deploy-vercel.yml" ? checkDeployWorkflow(text) : []),
    ...(file === "ci.yml"
      ? [
          ...checkCiWorkflow(text),
          ...verifyParityProblems(text),
          ...e2eProjectParityProblems(readFileSync("playwright.config.ts", "utf8"), text),
        ]
      : []),
  ];
  for (const problem of problems) console.error(`${file}: ${problem}`);
  if (problems.length) failed = true;
  else console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);
