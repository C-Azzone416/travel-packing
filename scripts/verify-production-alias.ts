// Usage: tsx scripts/verify-production-alias.ts <the deployed URL> <the Production alias>
//   (VERCEL_TOKEN, VERCEL_ORG_ID and GITHUB_SHA in the environment)
// Production only: proves the public alias serves the deployment this run created, from the commit this run releases, before any
// route is smoke-tested through it (see src/tooling/production-alias.ts). Read-only. Writes its own verdict line to the run
// summary, apart from the deployment's and the smoke test's. Exits 1 on anything it cannot prove; never prints the token.
import { appendFileSync } from "node:fs";
import { verifyProductionAlias } from "../src/tooling/production-alias";

function summary(line: string): void {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function main(): Promise<void> {
  const [deployUrl, alias] = process.argv.slice(2);
  const proof = await verifyProductionAlias({
    deployUrl: deployUrl ?? "",
    alias: alias ?? "",
    expectedSha: process.env.GITHUB_SHA,
    teamId: process.env.VERCEL_ORG_ID,
    token: process.env.VERCEL_TOKEN,
  });
  summary(
    `Production alias check: PASSED. https://${proof.alias} serves ${proof.deploymentId}, built from ${proof.sha.slice(0, 12)}.`,
  );
}

main().catch((error: unknown) => {
  summary(
    `Production alias check: FAILED. ${error instanceof Error ? error.message : "the alias could not be verified"}. The deployment above is live; no route was smoke-tested.`,
  );
  process.exit(1);
});
