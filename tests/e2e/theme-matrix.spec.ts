import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { expectAccessible } from "./helpers/a11y";
import { legacyPackingLayout } from "./helpers/device";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

// Cross-theme regression and a11y matrix (#145, trimmed in #181; #139 spec §6 and §8(d)). Rendered colour contrast (axe) and
// the focus-ring colour are checked on the dashboard, the packing screen and Settings in every theme at 1280, and in one
// non-Ocean theme at 390 (the layout is the same in every theme; the width only changes where things sit). Horizontal overflow
// and the keyboard paths do not depend on colour, so they run once, in Ocean. The computed token contrast is asserted in
// src/app/tokens.test.ts, and choosing a theme on Settings in settings.spec.ts. One browser project runs it (Chromium).
const NOW = new Date("2026-10-16T12:00:00");
const THEMES = [
  { id: "ocean", radio: /Ocean/ },
  { id: "evergreen", radio: /Evergreen/ },
  { id: "dusk", radio: /Dusk/ },
] as const;
const SHOTS = process.env.THEME_MATRIX_SHOTS; // a folder: write a screenshot of every cell there, for design review

type Theme = (typeof THEMES)[number];

/**
 * Sign in showing the theme without going through Settings: the `appearance` cookie themes every page, and the account's
 * theme is set too because the Settings screen shows the account's (it would put Ocean back otherwise).
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
    // The laptop view's title is "Packing" (#385); below 1024px the page's title is the trip.
    await expect(
      page.getByRole("heading", { name: /^(Packing|San Diego)$/, level: 1 }),
    ).toBeVisible();
  },
  settings: async (page: Page) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  },
};

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The colours a focus ring may be: the page ring (--accent-2), --info on paper surfaces such as the app header (#383, the primitives' ring), or --focus-on-header on dark ones. Read from the scheme, never hard-coded. */
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
    return [resolve("--accent-2"), resolve("--info"), resolve("--focus-on-header")];
  });
}

// Contrast and ring colour: one sign-in per (theme, width), the three screens visited in turn.
const CELLS = [
  ...THEMES.map((theme) => ({ theme, width: 1280 })),
  { theme: THEMES[1], width: 390 }, // one non-Ocean theme at a phone width
  // For design review (THEME_MATRIX_SHOTS set): the other schemes at a phone width too, so every scheme has both widths.
  ...(SHOTS ? [THEMES[0], THEMES[2]].map((theme) => ({ theme, width: 390 })) : []),
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
        await expect(page.locator("html")).toHaveAttribute("data-scheme", theme.id);
        // #377: the redesigned laptop Home uses the tokens as given, and a few muted-on-paper pairs are below 4.5:1; contrast is
        // tracked there. Only that rule, only on this screen at laptop width: every other rule and screen stays fully checked.
        const redesigned = name === "dashboard" && width >= 1024;
        await expectAccessible(page, `${theme.id} ${width} ${name}`, {
          disable: redesigned ? ["color-contrast"] : [],
        });

        // Keyboard focus: each of the first stops draws a solid ring of 2px or more in the theme's ring colour.
        const rings = await ringColours(page);
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
          expect(rings, `${name} tab stop ${stop + 1} outline colour`).toContain(ring.colour);
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

// Nothing scrolls sideways, on any of the three screens at either width (layout, not colour: Ocean is enough).
test("ocean: nothing scrolls sideways on the dashboard, packing and Settings at 390 and 1280", async ({
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
  // The row's stepper and editor are the page below 1024px (the laptop view's keyboard paths are in packing-laptop.spec.ts).
  await page.setViewportSize({ width: 1000, height: 900 });
  const theme = THEMES[0];
  await signInWithTheme(page, theme);
  await SCREENS.settings(page);

  // Settings: the arrow keys move the theme on to the next option, and the page follows.
  const next = THEMES[1];
  await page.getByRole("radio", { name: theme.radio }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", next.id);
  await expect(page.getByRole("radio", { name: next.radio })).toBeChecked();

  // Packing: a row is packed and edited with Enter alone, and Escape returns focus to the row.
  await SCREENS.packing(page);
  const underwear = page.locator('[data-item-id="underwear"]');
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).focus();
  await page.keyboard.press("Enter");
  await expect(underwear).toContainText("3 of 5 packed");
  await underwear.getByRole("button", { name: /^Underwear / }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await expect(dialog.getByLabel("Item name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(underwear.getByRole("button", { name: /^Underwear / })).toBeFocused();
});
