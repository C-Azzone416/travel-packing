// Usage: tsx scripts/cleanup-previews.ts <the deployed URL> <the alias name>   (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID in the environment)
// Deletes every Preview deployment except the one the alias now points to (see src/tooling/preview-cleanup.ts). Logs counts only.
// Always exits 0: tidying up must never fail or undo a deploy that already succeeded.
import { appendFileSync } from "node:fs";
import { describeCleanup, runPreviewCleanup } from "../src/tooling/preview-cleanup";

async function main(): Promise<void> {
  const [deployUrl, alias] = process.argv.slice(2);
  const line = describeCleanup(
    await runPreviewCleanup({
      deployUrl: deployUrl ?? "",
      alias: alias ?? "",
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      token: process.env.VERCEL_TOKEN,
    }),
  );
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

main().catch(() => {
  console.log("preview-cleanup: nothing deleted (unexpected error)");
});
