// Usage: tsx scripts/check-deploy-env.ts <preview|production> <path to the file `vercel pull` wrote>
// Reads PRODUCTION_DB_HOST from the environment (a repository secret, masked in the log). Run it AFTER the preview secrets are injected (see inject-preview-secrets.ts). Prints variable names only.

import { appendFileSync, readFileSync } from "node:fs";
import {
  accountClosureMode,
  checkDeployEnv,
  parseBuildEnvFile,
  type DeployTarget,
} from "../src/tooling/deploy-env";

const [target, file] = process.argv.slice(2);
if ((target !== "preview" && target !== "production") || !file) {
  console.error("usage: check-deploy-env <preview|production> <env file>");
  process.exit(2);
}
const env = parseBuildEnvFile(readFileSync(file, "utf8"));
const problems = checkDeployEnv(
  target as DeployTarget,
  // Both targets are checked exactly as `vercel build` reads the file after their Secrets are injected.
  env,
  process.env.PRODUCTION_DB_HOST,
);
if (problems.length) {
  for (const problem of problems) console.error(`deploy env: ${problem}`);
  process.exit(1);
}
console.log(`deploy env: ok for ${target}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `account_closure=${accountClosureMode(env)}\n`);
}
