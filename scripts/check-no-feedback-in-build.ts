// Framebriar is Preview-only. Fail if its UI or any used browser-SDK chunk enters a Production build.
// Run after both production bundlers; Preview, local and e2e builds intentionally contain this code.

import { statSync } from "node:fs";
import { FRAMEBRIAR_MARKERS, markerHits } from "../src/tooling/build-markers";

// Usage: tsx scripts/check-no-feedback-in-build.ts [dir...]   (default .next)
// Pass `.vercel/output .next` to check what a deploy uploads: the output holds the browser files, while its server functions point at
// the compiled server files in `.next`, which is where server-side Framebriar code would be.
const DIRS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [".next"];

for (const dir of DIRS) {
  try {
    statSync(dir);
  } catch {
    console.error(`No ${dir} directory: build Production first.`);
    process.exit(2);
  }
}

const hits = DIRS.flatMap((dir) => markerHits(dir, FRAMEBRIAR_MARKERS));
if (hits.length > 0) {
  for (const name of new Set(hits.map((hit) => hit.name))) {
    const files = hits.filter((hit) => hit.name === name);
    console.error(`${name} is present in the Production build (${files.length} files):`);
    for (const file of files.slice(0, 10)) console.error(`  ${file.path}`);
  }
  process.exit(1);
}
console.log("ok: no Framebriar UI or browser SDK is in this Production build");
