import { test, type Page } from "@playwright/test";

// Marks the specs that run on the `phone` project (real iPhone emulation, WebKit): the ones whose result depends on the
// device, not on the app's logic. The `phone` project in playwright.config.ts runs only tests carrying this tag; the `desktop`
// project runs every test. Add it to a spec only when a phone-shaped browser can catch something Chromium at 1440px cannot:
// layout, touch target size, overflow, the bottom navigation and sheets, accessibility at a phone size, or the golden path.
export const DEVICE = { tag: "@device" } as const;

/** Inside the phone-in-a-640-column band (601-767px, #414): the widest the phone layouts (phone Home, phone Pack mode) are drawn;
 * 768-1023 is the tablet Packing. */
export const PHONE_LAYOUT_VIEWPORT = { width: 700, height: 900 } as const;

/**
 * Runs the rest of a desktop test on the phone layouts (below 1024px): the phone Home with its four pills (#388) and the phone
 * Pack mode (#386). A spec whose subject is a flow that starts on the Home and does not care about the laptop layout calls
 * this. The phone project already runs at its own size.
 */
export async function phoneHomeLayout(page: Page): Promise<void> {
  if (test.info().project.name === "desktop") await page.setViewportSize(PHONE_LAYOUT_VIEWPORT);
}

/**
 * Plan a trip lays out its steps and live preview from 1024px (#390), while the phone Home needs a width under it
 * (phoneHomeLayout). A test that asserts the laptop Plan screen calls this after opening it, and calls phoneHomeLayout
 * again before it looks at the phone Home.
 */
export async function laptopPlanLayout(page: Page): Promise<void> {
  if (test.info().project.name === "desktop")
    await page.setViewportSize({ width: 1440, height: 1000 });
}
