import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";

// Cross-theme regression and a11y matrix (#145, #139 spec §6 and §8(d)): every theme on the dashboard, the packing screen and
// Settings at a phone width (390) and a desktop width (1280). Each cell checks that nothing scrolls sideways, that axe finds no
// violation (this is where colour contrast is measured on the rendered page, per theme), and that keyboard focus is drawn in the
// theme's own ring colour. The computed token contrast is asserted in src/app/tokens.test.ts. One browser project runs it
// (Chromium); the width is set per test.
const NOW = new Date("2026-10-16T12:00:00");
const THEMES = [
  { id: "base", radio: /Base palette/ },
  { id: "ocean", radio: /Deep Ocean/ },
  { id: "terracotta", radio: /Terracotta/ },
  { id: "violet", radio: /Ink Violet/ },
] as const;
const WIDTHS = [390, 1280] as const;
const SHOTS = process.env.THEME_MATRIX_SHOTS; // a folder: write a screenshot of every cell there, for design review

type Theme = (typeof THEMES)[number];

/** Sign in, choose the theme on Settings (saved to the account, so every page agrees), and wait until it is saved. */
async function signInWithTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("radio", { name: theme.radio }).check();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", theme.id);
  if (theme.id !== "base") await expect(page.getByText(/^Last saved /)).toBeVisible();
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

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    for (const [name, open] of Object.entries(SCREENS)) {
      test(`${theme.id} at ${width}px: ${name} has no sideways scroll, no axe violation, and a visible focus ring`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
        await signInWithTheme(page, theme);
        await open(page);
        await expect(page.locator("html")).toHaveAttribute("data-appearance", theme.id);

        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          "horizontal overflow",
        ).toBeLessThanOrEqual(0);

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
          expect(ring.style, `tab stop ${stop + 1} outline style`).toBe("solid");
          expect(ring.width, `tab stop ${stop + 1} outline width`).toBeGreaterThanOrEqual(2);
          expect([pageRing, headerRing], `tab stop ${stop + 1} outline colour`).toContain(
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
  }
}

// The keyboard paths, once per theme at the desktop width (the paths do not depend on the width).
for (const theme of THEMES) {
  test(`${theme.id}: the Theme radiogroup and a packing row work from the keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithTheme(page, theme);

    // Settings: the arrow keys move the theme on to the next option (and wrap), and the page follows.
    const order = THEMES.map((t) => t.id);
    const next = order[(order.indexOf(theme.id) + 1) % order.length];
    await page.getByRole("radio", { name: theme.radio }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("html")).toHaveAttribute("data-appearance", next);
    await expect(
      page.getByRole("radio", { name: THEMES.find((t) => t.id === next)!.radio }),
    ).toBeChecked();

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
}
