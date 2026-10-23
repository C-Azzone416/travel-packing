// Usage: tsx scripts/smoke-test.ts <deployment url>   (optional VERCEL_AUTOMATION_BYPASS_SECRET for protected previews)
import { appendFileSync } from "node:fs";
import { smokeTest } from "../src/tooling/smoke-test";

const url = process.argv[2];
if (!url) {
  console.error("usage: smoke-test <deployment url>");
  process.exit(2);
}
smokeTest(url, fetch, { bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET }).then(
  (result) => {
    for (const line of result.lines) console.log(line);
    // Its own line on the run summary, apart from the deployment's: a live deployment with a failed smoke test must read that way.
    const verdict = `Smoke test: ${result.ok ? "PASSED" : "FAILED"} for ${new URL(url).origin}${
      result.vercelAuthentication
        ? " (Vercel Authentication answered; the app was not reached)"
        : ""
    }.`;
    console.log(verdict);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict}\n`);
    process.exit(result.ok ? 0 : 1);
  },
);
