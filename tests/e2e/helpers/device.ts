import { test, type Page } from "@playwright/test";

// Marks the specs that run on the `phone` project (real iPhone emulation, WebKit): the ones whose result depends on the
// device, not on the app's logic. The `phone` project in playwright.config.ts runs only tests carrying this tag; the `desktop`
// project runs every test. Add it to a spec only when a phone-shaped browser can catch something Chromium at 1440px cannot:
// layout, touch target size, overflow, the bottom navigation and sheets, accessibility at a phone size, or the golden path.
export const DEVICE = { tag: "@device" } as const;

/** Just under the laptop breakpoint (1024px, #376): the width where the ledger Home (until #388) still renders; the trip page is the phone Pack mode (#386). */
export const LEGACY_PACKING_VIEWPORT = { width: 1000, height: 900 } as const;

/**
 * Runs the rest of a desktop test below 1024px. The Home screen is the laptop suitcase view from 1024px up (#387) and the ledger
 * Home below it (until #388), and the trip page is the phone Pack mode below 1024px (#386). A spec whose subject is a flow that
 * starts on the ledger Home keeps running there. The phone project already runs at its own size.
 */
export async function legacyPackingLayout(page: Page): Promise<void> {
  if (test.info().project.name === "desktop") await page.setViewportSize(LEGACY_PACKING_VIEWPORT);
}

/**
 * Plan a trip lays out its steps and live preview from 1024px (#390), while the ledger Home and trip page need a width under
 * it (legacyPackingLayout). A test that asserts the laptop Plan screen calls this after opening it, and calls
 * legacyPackingLayout again before it looks at the ledger dashboard.
 */
export async function laptopPlanLayout(page: Page): Promise<void> {
  if (test.info().project.name === "desktop")
    await page.setViewportSize({ width: 1440, height: 1000 });
}
