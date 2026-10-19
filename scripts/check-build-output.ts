// Usage: tsx scripts/check-build-output.ts [output dir, default .vercel/output]
// Fails if the output `vercel build` made has no server functions (it would deploy and answer every request with a 404).
import { buildOutputProblems } from "../src/tooling/build-output";

const dir = process.argv[2] ?? ".vercel/output";
const problems = buildOutputProblems(dir);
if (problems.length) {
  for (const problem of problems) console.error(`build output: ${problem}`);
  process.exit(1);
}
console.log("build output: ok, it has server functions");
