// Framebriar is local-only. Fail if its UI or any used browser-SDK chunk enters a deployable Preview/Production build.
// Run after both production bundlers; the e2e build intentionally contains this code and is never deployed.

import { statSync } from "node:fs";
import { FRAMEBRIAR_MARKERS, markerHits } from "../src/tooling/build-markers";

const BUILD_DIR = ".next";

try {
  statSync(BUILD_DIR);
} catch {
  console.error(`No ${BUILD_DIR} directory: run \`npm run build:production\` first.`);
  process.exit(2);
}

const hits = markerHits(BUILD_DIR, FRAMEBRIAR_MARKERS);
if (hits.length > 0) {
  for (const name of new Set(hits.map((hit) => hit.name))) {
    const files = hits.filter((hit) => hit.name === name);
    console.error(`${name} is present in the hosted build (${files.length} files):`);
    for (const file of files.slice(0, 10)) console.error(`  ${file.path}`);
  }
  process.exit(1);
}
console.log("ok: no Framebriar UI or browser SDK is in this hosted build");
