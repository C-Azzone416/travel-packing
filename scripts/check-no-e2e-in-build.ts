// Fails if any e2e-only module made it into a build. Run after `npm run build` (without NEXT_PUBLIC_E2E_BUILD=1).
// Each marker is a string that exists only in that module.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKERS: readonly { name: string; text: string }[] = [
  { name: "the e2e fake sign-in", text: "e2e-auth-session" },
  { name: "the e2e Postgres driver", text: "e2e-test-only-pg-driver" },
  // The sample trips in src/features/trips/fixtures.ts are for tests only; the dashboard reads real data.
  { name: "the dashboard sample-trip fixtures", text: "Lisbon, Lisboa, Portugal" },
];
const BUILD_DIR = ".next";

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
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
  for (const marker of MARKERS) {
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
