// Fails if any e2e-only module made it into a build. Run after `npm run build` (without NEXT_PUBLIC_E2E_BUILD=1).
// Each marker (src/tooling/build-markers.ts) is a string that exists only in that module.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUILD_MARKERS } from "../src/tooling/build-markers";

const BUILD_DIR = ".next";

function* files(dir: string, root = dir): Generator<string> {
  for (const name of readdirSync(dir)) {
    // Incremental compiler inputs are not deployed and can describe a different build mode from the current output.
    if (dir === root && name === "cache") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, root);
    else yield path;
  }
}

function main(): void {
  try {
    statSync(BUILD_DIR);
  } catch {
    console.error(`No ${BUILD_DIR} directory: run \`npm run build\` first.`);
    process.exit(2);
  }
  const contents = [...files(BUILD_DIR)].map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
  let failed = false;
  for (const marker of BUILD_MARKERS) {
    const hits = contents.filter((file) => file.text.includes(marker.text));
    if (hits.length === 0) continue;
    failed = true;
    console.error(`${marker.name} is present in the build (${hits.length} files):`);
    for (const hit of hits.slice(0, 10)) console.error(`  ${hit.path}`);
  }
  if (failed) process.exit(1);
  console.log("ok: no e2e-only module is in this build");
}

main();
