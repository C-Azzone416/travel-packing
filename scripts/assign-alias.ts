// Usage: tsx scripts/assign-alias.ts <the deployed URL> <the alias name>   (VERCEL_TOKEN and VERCEL_ORG_ID in the environment)
// Points the stable Preview alias at the deployment through Vercel's REST API (see src/tooling/alias-api.ts). Exits 1, with the
// alias untouched, on any refusal; never prints the token.
import { appendFileSync } from "node:fs";
import { assignAlias } from "../src/tooling/alias-api";

async function main(): Promise<void> {
  const [deployUrl, alias] = process.argv.slice(2);
  const result = await assignAlias({
    deployUrl: deployUrl ?? "",
    alias: alias ?? "",
    teamId: process.env.VERCEL_ORG_ID,
    token: process.env.VERCEL_TOKEN,
  });
  const line = `Preview alias: https://${result.alias} -> https://${result.host} (${result.deploymentId}${
    result.previous ? `, replacing ${result.previous}` : ", first assignment"
  })`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

main().catch((error: unknown) => {
  console.error(`alias: ${error instanceof Error ? error.message : "the alias was not assigned"}`);
  process.exit(1);
});
