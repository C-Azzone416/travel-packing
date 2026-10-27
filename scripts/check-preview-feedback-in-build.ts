// Fail unless every Framebriar app/SDK marker is present in a Preview build. This is the positive counterpart to the
// Production absence check: it catches a build-mode regression that would make the stable Preview silently inert.

import { statSync } from "node:fs";
import { FRAMEBRIAR_MARKERS, markerHits } from "../src/tooling/build-markers";

const BUILD_DIR = ".next";

try {
  statSync(BUILD_DIR);
} catch {
  console.error(`No ${BUILD_DIR} directory: run \`npm run build:preview\` first.`);
  process.exit(2);
}

const hits = markerHits(BUILD_DIR, FRAMEBRIAR_MARKERS);
const names = new Set(hits.map((hit) => hit.name));
const missing = FRAMEBRIAR_MARKERS.filter((marker) => !names.has(marker.name));

if (missing.length > 0) {
  for (const marker of missing) console.error(`${marker.name} is missing from the Preview build`);
  process.exit(1);
}

console.log("ok: Framebriar UI and each used browser SDK chunk are in the Preview build");
