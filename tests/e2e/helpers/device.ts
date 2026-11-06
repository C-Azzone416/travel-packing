import { test, type Page } from "@playwright/test";

// Marks the specs that run on the `phone` project (real iPhone emulation, WebKit): the ones whose result depends on the
// device, not on the app's logic. The `phone` project in playwright.config.ts runs only tests carrying this tag; the `desktop`
// project runs every test. Add it to a spec only when a phone-shaped browser can catch something Chromium at 1440px cannot:
// layout, touch target size, overflow, the bottom navigation and sheets, accessibility at a phone size, or the golden path.
export const DEVICE = { tag: "@device" } as const;

/** Just under the laptop breakpoint (1024px, #376): the width where the current (pre-redesign) Packing page still renders. */
export const LEGACY_PACKING_VIEWPORT = { width: 1000, height: 900 } as const;

/**
 * Runs the rest of a desktop test on the layout below 1024px. Since #385 the trip page is a different screen from 1024px up
 * (the suitcase view, tests/e2e/packing-laptop.spec.ts), while below it the page is unchanged until the phone redesign (#386).
 * A spec whose subject is a flow (create, copy, Ready, weather review, stamps ...) and not the laptop layout keeps running
 * against that page here; #386 moves these onto the phone redesign. The phone project already runs at its own size.
 */
export async function legacyPackingLayout(page: Page): Promise<void> {
  if (test.info().project.name === "desktop") await page.setViewportSize(LEGACY_PACKING_VIEWPORT);
}
