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
  // The seam that points the server's Framebriar client at the e2e fake service (#260).
  {
    name: "the e2e Framebriar upstream seam",
    text: "e2e-framebriar-upstream",
    source: "src/server/feedback/e2e-upstream.ts",
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

// Framebriar must appear in Preview and stay absent from Production. These cover the app UI and each SDK chunk the app
// can load (access, durable outbox and local report preparation), rather than relying on one tree-shaken symbol.
export const FRAMEBRIAR_MARKERS: readonly BuildMarker[] = [
  {
    name: "the Framebriar settings UI",
    text: "Send feedback to the developer",
    source: "src/features/feedback/FeedbackSettings.tsx",
  },
  {
    name: "the Feedback entry in the trip editor",
    text: "data-feedback-editor-entry",
    source: "src/features/feedback/FeedbackEditorEntry.tsx",
  },
  {
    name: "the Framebriar per-account report queue SDK",
    text: "Local feedback storage is full",
    source: "node_modules/@masra91/framebriar/adapters/browser/queue.mjs",
  },
  {
    name: "the app's per-account outbox scope",
    text: "Not an outbox key",
    source: "src/features/feedback/account-scope.ts",
  },
  {
    name: "the app's report proxy transport",
    text: "The answer did not match this report. It is kept.",
    source: "src/features/feedback/delivery.ts",
  },
  {
    name: "the screenshot annotation editor",
    text: "Drawing needs a finger, a pen or a mouse",
    source: "src/features/feedback/ScreenshotEditor.tsx",
  },
  // The "Disconnect feedback first" step of Close account (#261). Next swaps the whole module for a stub in Production (#311).
  {
    name: "the Close account feedback step",
    text: "possibly from another device or tab",
    source: "src/features/feedback/CloseAccountFeedback.tsx",
  },
  {
    name: "the Framebriar durable outbox SDK",
    text: "outbox-v2-",
    source: "node_modules/@masra91/framebriar/adapters/browser/durable-feedback.mjs",
  },
  {
    name: "the Framebriar server enrollment and report proxy",
    text: "framebriar-enrollment-server",
    source: "src/server/feedback/key-ring.ts",
  },
  {
    name: "the Framebriar local report SDK",
    text: "A reviewed PNG of at most 8 MiB is required",
    source: "node_modules/@masra91/framebriar/adapters/browser/local-export.mjs",
  },
];

// What no build with feedback in it may contain (#260): the SDK's browser-held enrollment. Since the enrollment moved to the server,
// no refresh or access credential has a storage path in the browser, so these modules (the controller that redeems, refreshes and
// stores one, and its IndexedDB store) must never reach a Preview, local or e2e bundle either. They are texts unique to those SDK
// files, checked by `check:preview-feedback-in-build` next to the markers above.
export const FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS: readonly BuildMarker[] = [
  {
    name: "the SDK's browser access controller (redeems and refreshes a credential)",
    text: "Playtest access unavailable",
    source: "node_modules/@masra91/framebriar/adapters/browser/playtest-access.mjs",
  },
  {
    name: "the SDK's browser enrollment store (keeps a credential in IndexedDB)",
    text: "Enrollment storage unavailable",
    source: "node_modules/@masra91/framebriar/adapters/browser/enrollment-store.mjs",
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
      // Next keeps incremental compiler inputs from earlier build modes here. They are not emitted/deployed artifacts and
      // may legitimately contain Preview code after a subsequent Production build in the same checkout.
      if (current === dir && entry === "cache") continue;
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
