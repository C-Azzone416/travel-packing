// Usage: tsx scripts/check-workflows.ts   (from the repository root; CI runs it next to actionlint)
// Every workflow's actions must be pinned to a full SHA, the deploy workflow must keep its safety contract, and ci.yml
// must run the same checks as `npm run verify`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkCiWorkflow,
  checkDeployWorkflow,
  checkVercelConfig,
  dependabotProblems,
  checkVercelCliLock,
  unpinnedActions,
} from "../src/tooling/workflow-check";
import { e2eProjectParityProblems, verifyParityProblems } from "../src/tooling/verify";

const dir = join(".github", "workflows");
let failed = false;
for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
  const text = readFileSync(join(dir, file), "utf8");
  const problems = [
    ...unpinnedActions(text),
    ...(file === "deploy-vercel.yml"
      ? [
          ...checkDeployWorkflow(text),
          ...checkVercelCliLock(
            text,
            readFileSync(join("tools", "vercel-cli", "package.json"), "utf8"),
            readFileSync(join("tools", "vercel-cli", "package-lock.json"), "utf8"),
          ),
        ]
      : []),
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
const dependabot = dependabotProblems(readFileSync(join(".github", "dependabot.yml"), "utf8"));
for (const problem of dependabot) console.error(`dependabot.yml: ${problem}`);
if (dependabot.length) failed = true;
else console.log("dependabot.yml: ok");
const vercelConfig = checkVercelConfig(readFileSync("vercel.json", "utf8"));
for (const problem of vercelConfig) console.error(`vercel.json: ${problem}`);
if (vercelConfig.length) failed = true;
else console.log("vercel.json: ok");
process.exit(failed ? 1 : 0);
