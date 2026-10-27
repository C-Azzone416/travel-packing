// Runs immediately before `vercel build` in the same workflow step. Names only; never prints a credential value.
import { packageCredentialProblems } from "../src/tooling/deploy-env";

const problems = packageCredentialProblems(process.env);
if (problems.length) {
  for (const problem of problems) console.error(`build credential: ${problem}`);
  process.exit(1);
}
console.log("build credential: package authentication is absent");
