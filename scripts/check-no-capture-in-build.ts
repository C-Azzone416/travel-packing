// Fails if screenshot capture code made it into a PRODUCTION-mode build (#130). Run after `npm run build:production`
// (or `build:webpack`), which set VERCEL_ENV=production so next.config.ts swaps the capture module for its stub.

import { statSync } from "node:fs";
import { CAPTURE_MARKERS, markerHits } from "../src/tooling/build-markers";

const BUILD_DIR = ".next";

try {
  statSync(BUILD_DIR);
} catch {
  console.error(`No ${BUILD_DIR} directory: run \`npm run build:production\` first.`);
  process.exit(2);
}
const hits = markerHits(BUILD_DIR, CAPTURE_MARKERS);
if (hits.length > 0) {
  for (const name of new Set(hits.map((hit) => hit.name))) {
    const files = hits.filter((hit) => hit.name === name);
    console.error(`${name} is present in the production build (${files.length} files):`);
    for (const file of files.slice(0, 10)) console.error(`  ${file.path}`);
  }
  process.exit(1);
}
console.log("ok: no screenshot capture code is in this production build");
