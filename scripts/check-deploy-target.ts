// Usage: tsx scripts/check-deploy-target.ts <preview|production> <file holding the `vercel deploy` output>
// Fails if the deployment did not land in the environment this run meant it to. Prints a verdict only.
import { readFileSync } from "node:fs";
import { deployTargetProblems } from "../src/tooling/deploy-target";

const [target, file] = process.argv.slice(2);
if ((target !== "preview" && target !== "production") || !file) {
  console.error("usage: check-deploy-target <preview|production> <deploy output file>");
  process.exit(2);
}
let output = "";
try {
  output = readFileSync(file, "utf8");
} catch {
  console.error("deploy target: the deploy output could not be read");
  process.exit(1);
}
const problems = deployTargetProblems(target, output);
if (problems.length) {
  for (const problem of problems) console.error(`deploy target: ${problem}`);
  process.exit(1);
}
console.log(`deploy target: ok, a ${target} deployment`);
