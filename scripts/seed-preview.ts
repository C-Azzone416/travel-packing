// Usage (the preview deploy job only): tsx scripts/seed-preview.ts
// Seeds the preview database for PREVIEW_SEED_OWNER_ID, or skips visibly when it is not set yet (first-preview bootstrap).
import { appendFileSync } from "node:fs";
import { realDeps, runSeedCli } from "../src/server/seed/cli";
import { runPreviewSeed } from "../src/server/seed/preview";

const summaryFile = process.env.GITHUB_STEP_SUMMARY;

runPreviewSeed(process.env, {
  seed: (env) => runSeedCli(["--yes"], env, realDeps),
  log: (line) => console.log(line),
  summary: (line) => {
    if (summaryFile) appendFileSync(summaryFile, `${line}\n`);
  },
}).then((code) => process.exit(code));
