import { expect, type BrowserContext, type Page } from "@playwright/test";

/** The four palettes: the id, the Settings radio's name and the accent colour the role tokens give it. */
export const PALETTES = [
  { id: "base", radio: /Base palette/, accent: "#a64a39" },
  { id: "ocean", radio: /Deep Ocean/, accent: "#2d6674" },
  { id: "terracotta", radio: /Terracotta/, accent: "#ad513b" },
  { id: "violet", radio: /Ink Violet/, accent: "#66546f" },
] as const;
export type Palette = (typeof PALETTES)[number];

export const ANONYMOUS_COOKIE = "anon-appearance";

export const anonymousCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === ANONYMOUS_COOKIE);

/** The `<html ...>` tag of a page's server HTML. */
export const htmlTag = (html: string) => /<html\b[^>]*>/.exec(html)?.[0] ?? "";

/** On Settings, choose a palette for real (the server action saves it) and wait until the server confirmed it. */
export async function chooseTheme(page: Page, context: BrowserContext, palette: Palette) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.getByRole("radio", { name: palette.radio }).check();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", palette.id);
  // The anonymous cookie is httpOnly and only the server action sets it, so seeing it proves the save completed.
  await expect.poll(async () => (await anonymousCookie(context))?.value).toBe(palette.id);
}

/** Press Settings' Sign out for real (no hand-set cookie) and wait for the sign-in screen. */
export async function signOutFromSettings(page: Page) {
  await page.goto("/settings");
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Choose a palette in Settings, then sign out. Base is chosen by first moving off it, so a real save happens. */
export async function chooseThemeAndSignOut(page: Page, context: BrowserContext, palette: Palette) {
  if (palette.id === "base") await chooseTheme(page, context, PALETTES[1]);
  await chooseTheme(page, context, palette);
  await signOutFromSettings(page);
}
