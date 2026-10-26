import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Strings that must never appear in a normal build, each unique to one module that must stay out of it. `source` is the
// file that holds the string, and build-markers.test.ts checks that it still does, so renaming or editing the string
// there cannot leave `check:no-e2e-in-build` looking for something that no longer exists.

export interface BuildMarker {
  name: string;
  text: string;
  source: string;
}

export const BUILD_MARKERS: readonly BuildMarker[] = [
  {
    name: "the e2e fake sign-in",
    text: "e2e-auth-session",
    source: "src/server/auth/e2e-provider.ts",
  },
  {
    name: "the e2e Postgres driver",
    text: "e2e-test-only-pg-driver",
    source: "src/server/db/e2e-driver.ts",
  },
  // The sample trips are for tests only; the dashboard reads real data.
  {
    name: "the dashboard sample-trip fixtures",
    text: "Lisbon, Lisbon District, Portugal",
    source: "src/features/trips/fixtures.ts",
  },
];

// Strings unique to the screenshot capture code, which must never be in a PRODUCTION build (#130). Unlike the markers above,
// they legitimately appear in Preview, local and e2e builds, so `check:no-capture-in-build` is only run on a production-mode
// build (VERCEL_ENV=production), where next.config.ts resolves the capture module to its stub.
export const CAPTURE_MARKERS: readonly BuildMarker[] = [
  {
    name: "the screenshot capture module",
    text: "feedback-screenshot-capture",
    source: "src/features/feedback/screenshot-capture.ts",
  },
];

// Local-only Framebriar must not appear anywhere in a hosted build. These cover the app UI and each SDK chunk the app
// can load (access, durable outbox and local report preparation), rather than relying on one tree-shaken symbol.
export const FRAMEBRIAR_MARKERS: readonly BuildMarker[] = [
  {
    name: "the Framebriar settings UI",
    text: "Send feedback to the developer",
    source: "src/features/feedback/FeedbackSettings.tsx",
  },
  {
    name: "the Framebriar access SDK",
    text: "Playtest access unavailable",
    source: "node_modules/@masra91/framebriar/adapters/browser/playtest-access.mjs",
  },
  {
    name: "the Framebriar durable outbox SDK",
    text: "outbox-v2-",
    source: "node_modules/@masra91/framebriar/adapters/browser/durable-feedback.mjs",
  },
  {
    name: "the Framebriar local report SDK",
    text: "A reviewed PNG of at most 8 MiB is required",
    source: "node_modules/@masra91/framebriar/adapters/browser/local-export.mjs",
  },
];

/** Every build file that contains one of the markers' text: `{ marker name, file path }`. Reads text files under `dir`. */
export function markerHits(
  dir: string,
  markers: readonly BuildMarker[],
): { name: string; path: string }[] {
  const hits: { name: string; path: string }[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) visit(path);
      else {
        const text = readFileSync(path, "utf8");
        for (const marker of markers)
          if (text.includes(marker.text)) hits.push({ name: marker.name, path });
      }
    }
  };
  visit(dir);
  return hits;
}
