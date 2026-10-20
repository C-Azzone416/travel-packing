// Marks the specs that run on the `phone` project (real iPhone emulation, WebKit): the ones whose result depends on the
// device, not on the app's logic. The `phone` project in playwright.config.ts runs only tests carrying this tag; the `desktop`
// project runs every test. Add it to a spec only when a phone-shaped browser can catch something Chromium at 1440px cannot:
// layout, touch target size, overflow, the bottom navigation and sheets, accessibility at a phone size, or the golden path.
export const DEVICE = { tag: "@device" } as const;
