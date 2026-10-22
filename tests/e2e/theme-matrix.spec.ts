import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { expectAccessible } from "./helpers/a11y";

// Cross-theme regression and a11y matrix (#145, trimmed in #181; #139 spec §6 and §8(d)). Rendered colour contrast (axe) and
// the focus-ring colour are checked on the dashboard, the packing screen and Settings in every theme at 1280, and in one
// non-Base theme at 390 (the layout is the same in every theme; the width only changes where things sit). Horizontal overflow
// and the keyboard paths do not depend on colour, so they run once, in Base. The computed token contrast is asserted in
// src/app/tokens.test.ts, and choosing a theme on Settings in settings.spec.ts. One browser project runs it (Chromium).
const NOW = new Date("2026-10-16T12:00:00");
const THEMES = [
  { id: "base", radio: /Base palette/ },
  { id: "ocean", radio: /Deep Ocean/ },
  { id: "terracotta", radio: /Terracotta/ },
  { id: "violet", radio: /Ink Violet/ },
] as const;
const SHOTS = process.env.THEME_MATRIX_SHOTS; // a folder: write a screenshot of every cell there, for design review

type Theme = (typeof THEMES)[number];

/**
 * Sign in showing the theme without going through Settings: the `appearance` cookie themes every page, and the account's
 * theme is set too because the Settings screen shows the account's (it would put Base back otherwise).
 */
async function signInWithTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme.id);
  await page.context().addCookies([
    {
      name: "appearance",
      value: theme.id,
      url: test.info().project.use.baseURL ?? "http://localhost",
    },
  ]);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const SCREENS = {
  dashboard: async (page: Page) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  },
  packing: async (page: Page) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  },
  settings: async (page: Page) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  },
};

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The two colours a focus ring may be: the page ring (--accent-2) or, inside the header, --focus-on-header. */
async function ringColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    return [resolve("--accent-2"), resolve("--focus-on-header")];
  });
}

// Contrast and ring colour: one sign-in per (theme, width), the three screens visited in turn.
const CELLS = [
  ...THEMES.map((theme) => ({ theme, width: 1280 })),
  { theme: THEMES[1], width: 390 }, // one non-Base theme at a phone width
];
for (const { theme, width } of CELLS) {
  test(`${theme.id} at ${width}px: dashboard, packing and Settings have no axe violation and a visible focus ring`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await signInWithTheme(page, theme);
    for (const [name, open] of Object.entries(SCREENS)) {
      await test.step(name, async () => {
        await open(page);
        await expect(page.locator("html")).toHaveAttribute("data-appearance", theme.id);
        await expectAccessible(page, `${theme.id} ${width} ${name}`);

        // Keyboard focus: each of the first stops draws a solid ring of 2px or more in the theme's ring colour.
        const [pageRing, headerRing] = await ringColours(page);
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        for (let stop = 0; stop < 6; stop++) {
          await page.keyboard.press("Tab");
          const ring = await page.evaluate(() => {
            const style = getComputedStyle(document.activeElement as Element);
            return {
              style: style.outlineStyle,
              width: parseFloat(style.outlineWidth),
              colour: style.outlineColor,
            };
          });
          expect(ring.style, `${name} tab stop ${stop + 1} outline style`).toBe("solid");
          expect(ring.width, `${name} tab stop ${stop + 1} outline width`).toBeGreaterThanOrEqual(
            2,
          );
          expect([pageRing, headerRing], `${name} tab stop ${stop + 1} outline colour`).toContain(
            ring.colour,
          );
        }

        if (SHOTS)
          await page.screenshot({
            path: `${SHOTS}/${theme.id}-${width}-${name}.png`,
            fullPage: true,
          });
      });
    }
  });
}

// Nothing scrolls sideways, on any of the three screens at either width (layout, not colour: Base is enough).
test("base: nothing scrolls sideways on the dashboard, packing and Settings at 390 and 1280", async ({
  page,
}) => {
  await signInWithTheme(page, THEMES[0]);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    for (const [name, open] of Object.entries(SCREENS)) {
      await open(page);
      expect(await sidewaysScroll(page), `${name} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});

// The keyboard paths, once (they do not depend on colour or width).
test("the Theme radiogroup and a packing row work from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const theme = THEMES[0];
  await signInWithTheme(page, theme);
  await SCREENS.settings(page);

  // Settings: the arrow keys move the theme on to the next option, and the page follows.
  const next = THEMES[1];
  await page.getByRole("radio", { name: theme.radio }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", next.id);
  await expect(page.getByRole("radio", { name: next.radio })).toBeChecked();

  // Packing: a row is packed and edited with Enter alone, and Escape returns focus to the row.
  await SCREENS.packing(page);
  const underwear = page.locator('[data-item-id="underwear"]');
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).focus();
  await page.keyboard.press("Enter");
  await expect(underwear).toContainText("3 of 4 packed");
  await underwear.getByRole("button", { name: /^Underwear / }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await expect(dialog.getByLabel("Item name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(underwear.getByRole("button", { name: /^Underwear / })).toBeFocused();
});
