import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";

// The id Next's client sends in the `next-action` request header for one server action, read from the build the tests run against.
// A test that must interfere with exactly one action (hold it, abort it) matches on this id, never on "a POST to /": other actions
// go to the same path, and one of them arriving at the wrong moment takes the interference meant for the one under test.
// First used by the dashboard's "cannot load" state (#256, after the approach in #137). Fails loudly if the manifest is missing, its
// shape changes, or the (file, export) pair is not in it exactly once, so a rename or a Next upgrade is fixed here, in one place.
const MANIFEST = ".next/server/server-reference-manifest.json";

interface Manifest {
  node?: Record<string, { exportedName?: string; filename?: string }>;
}

export function serverActionId(file: string, exportName: string): string {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), MANIFEST), "utf8")) as Manifest;
  const matches = Object.entries(manifest.node ?? {}).filter(
    ([, reference]) => reference.filename === file && reference.exportedName === exportName,
  );
  expect(matches, `the built server reference ${exportName} in ${file} (exactly one)`).toHaveLength(
    1,
  );
  return matches[0][0];
}
