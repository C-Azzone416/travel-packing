// Usage: tsx scripts/smoke-test.ts <deployment url>   (optional VERCEL_AUTOMATION_BYPASS_SECRET for protected previews)
import { smokeTest } from "../src/tooling/smoke-test";

const url = process.argv[2];
if (!url) {
  console.error("usage: smoke-test <deployment url>");
  process.exit(2);
}
smokeTest(url, fetch, { bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET }).then(
  (result) => {
    for (const line of result.lines) console.log(line);
    process.exit(result.ok ? 0 : 1);
  },
);
