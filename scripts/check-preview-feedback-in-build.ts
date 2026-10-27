// Fail unless every Framebriar app/SDK marker is present in a Preview build. This is the positive counterpart to the
// Production absence check: it catches a build-mode regression that would make the stable Preview silently inert.

import { statSync } from "node:fs";
import {
  FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS,
  FRAMEBRIAR_MARKERS,
  markerHits,
} from "../src/tooling/build-markers";

const BUILD_DIR = process.argv[2] ?? ".next";

try {
  statSync(BUILD_DIR);
} catch {
  console.error(`No ${BUILD_DIR} directory: build Preview first.`);
  process.exit(2);
}

const hits = markerHits(BUILD_DIR, FRAMEBRIAR_MARKERS);
const names = new Set(hits.map((hit) => hit.name));
const missing = FRAMEBRIAR_MARKERS.filter((marker) => !names.has(marker.name));

if (missing.length > 0) {
  for (const marker of missing) console.error(`${marker.name} is missing from the Preview build`);
  process.exit(1);
}

// The enrollment lives on the server (#260): no browser credential code may be in a build that has feedback in it.
const credentialHits = markerHits(BUILD_DIR, FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS);
if (credentialHits.length > 0) {
  for (const name of new Set(credentialHits.map((hit) => hit.name))) {
    const files = credentialHits.filter((hit) => hit.name === name);
    console.error(
      `${name} is in the Preview build (${files.length} files); the browser must hold no credential:`,
    );
    for (const file of files.slice(0, 10)) console.error(`  ${file.path}`);
  }
  process.exit(1);
}

console.log(
  "ok: Framebriar UI and each used browser SDK chunk are in the Preview build, and no browser credential code is",
);
