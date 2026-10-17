// Fails if the e2e-only fake sign-in made it into a build. Run after `npm run build` (without
// NEXT_PUBLIC_E2E_BUILD=1). The marker is the fake provider's cookie name, which exists nowhere else.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKER = "e2e-auth-session";
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
  const hits = [...files(BUILD_DIR)].filter((path) => readFileSync(path, "utf8").includes(MARKER));
  if (hits.length > 0) {
    console.error(`The e2e-only sign-in is present in the build (${hits.length} files):`);
    for (const hit of hits.slice(0, 10)) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log("ok: the e2e-only sign-in is not in this build");
}

main();
