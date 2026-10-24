import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { E2E_PASSWORD, OTHER_EMAIL, newcomerEmailFor, signIn } from "./helpers/auth";
import { nextNewcomerSlot, resetAccount } from "./helpers/inbox";

// Field Ledger on the signed-out screens (#204), in every theme: sign-in (error and focused field), sign-up, verify, forgot password
// (and its sent state), reset and set password, an invalid link, finish setup and access-denied. Each shows the brand-only bar at the
// app header's height, a flat card with the 4px accent rule and no blur, and no sideways scroll; axe checks colour contrast in the
// theme. Axe runs in every theme at 1280 and in one theme at 390 (the layout is the same in each; the width only changes where
// things sit), as in theme-matrix.spec.ts. AUTH_SHOTS=<folder> writes a screenshot of every cell, in all eight (theme, width) pairs,
// for design's rendered review. One browser project runs it (Chromium); the phone width is a viewport, not WebKit.
const THEMES = ["base", "ocean", "terracotta", "violet"] as const;
const SHOTS = process.env.AUTH_SHOTS;
const BAR_HEIGHT = { 1280: 68, 390: 60 } as const;
// Only the shape of a link token matters here (the page shows the form for any well-formed one); built like the other specs do.
const TOKEN = "a".repeat(48);

const CELLS = [
  ...THEMES.map((theme) => ({ theme, width: 1280 as const, axe: true })),
  ...THEMES.map((theme) => ({ theme, width: 390 as const, axe: theme === "ocean" })),
].filter((cell) => cell.axe || SHOTS);

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let email: string;
test.beforeEach(({}, testInfo) => {
  email = newcomerEmailFor(testInfo.project.name, nextNewcomerSlot());
  resetAccount(email);
});

for (const { theme, width, axe } of CELLS) {
  test(`${theme} at ${width}px: every signed-out screen is a Ledger screen`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.context().addCookies([
      {
        name: "appearance",
        value: theme,
        url: test.info().project.use.baseURL ?? "http://localhost",
      },
    ]);

    const check = async (name: string) => {
      await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
      // The brand-only bar: circle and wordmark, no link, no navigation, the app header's height.
      const bar = page.locator("header.auth-brandbar");
      await expect(bar).toBeVisible();
      await expect(bar.getByText("Packed Smart")).toBeVisible();
      await expect(bar.getByRole("link")).toHaveCount(0);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      expect(
        (await bar.boundingBox())?.height,
        `${name}: the bar is ${BAR_HEIGHT[width]}px tall`,
      ).toBe(BAR_HEIGHT[width]);
      // A flat card: the 4px accent rule on top, a hairline, and no shadow.
      const card = page.locator(".auth-card");
      await expect(card).toHaveCSS("border-top-width", "4px");
      await expect(card).toHaveCSS("box-shadow", "none");
      // Top-aligned under the bar: the card does not float in the middle of the screen.
      const top = (await card.boundingBox())?.y ?? 0;
      const barBottom = BAR_HEIGHT[width];
      expect(
        top - barBottom,
        `${name}: the card sits ${width < 700 ? 64 : 96}px under the bar`,
      ).toBe(width < 700 ? 64 : 96);
      expect(await sidewaysScroll(page), `${name}: no sideways scroll`).toBeLessThanOrEqual(0);
      if (axe) await expectAccessible(page, `${theme} ${width} ${name}`);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: join(SHOTS, `${theme}-${width}-${name.replace(/\W+/g, "-")}.png`),
          fullPage: true,
        });
      }
    };

    await test.step("sign-in", async () => {
      await page.goto("/sign-in");
      await check("sign-in");
      // The toggle is inside the field, at its right edge, and a 44px target.
      const toggle = page.getByRole("button", { name: "Show password" });
      const field = page.getByLabel("Password");
      const toggleBox = (await toggle.boundingBox())!;
      const fieldBox = (await field.boundingBox())!;
      expect(toggleBox.height).toBeGreaterThanOrEqual(44);
      expect(toggleBox.x).toBeGreaterThanOrEqual(fieldBox.x);
      expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 1);
      expect(toggleBox.y).toBeGreaterThanOrEqual(fieldBox.y - 1);
    });
    await test.step("sign-in with an error", async () => {
      await page.getByLabel("Email").fill("nobody@example.test");
      await page.getByLabel("Password").fill("not-the-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const banner = page.locator(".auth-error");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveCSS("font-size", "15px");
      await expect(banner).toHaveCSS("font-weight", "600");
      await check("sign-in-error");
    });
    await test.step("sign-in with a focused field", async () => {
      await page.goto("/sign-in");
      await page.getByLabel("Email").focus();
      await check("sign-in-focus");
    });
    await test.step("sign-up", async () => {
      await page.goto("/sign-up");
      await check("sign-up");
    });
    await test.step("verify", async () => {
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/verify$/);
      await check("verify");
    });
    await test.step("forgot password", async () => {
      await page.goto("/forgot-password");
      await check("forgot-password");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /send/i }).click();
      await expect(page.getByRole("heading", { name: "Check your email", level: 1 })).toBeVisible();
      await check("forgot-password-sent");
    });
    await test.step("reset password, set password, invalid link", async () => {
      await page.goto(`/reset-password?token=${TOKEN}`);
      await check("reset-password");
      await page.goto(`/reset-password?token=${TOKEN}&setup=1`);
      await check("set-password");
      await page.goto("/reset-password");
      await check("invalid-link");
      // The sentence and the button under it are 16px apart, as on verify and reset-password (not squeezed to 4px).
      const sentence = (await page.locator(".auth-helper").boundingBox())!;
      const button = (await page
        .getByRole("link", { name: "Send a new reset link" })
        .boundingBox())!;
      expect(button.y - (sentence.y + sentence.height), "invalid-link: sentence to button").toBe(
        16,
      );
    });
    await test.step("finish setup", async () => {
      await page.goto("/finish-setup");
      await check("finish-setup");
    });
    await test.step("access-denied", async () => {
      await signIn(page, OTHER_EMAIL, E2E_PASSWORD);
      await expect(page).toHaveURL(/\/access-denied$/);
      await check("access-denied");
    });
  });
}
