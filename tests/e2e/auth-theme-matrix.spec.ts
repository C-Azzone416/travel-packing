import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { PALETTES, chooseThemeAndSignOut } from "./helpers/appearance";
import { E2E_PASSWORD, OTHER_EMAIL, newcomerEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { nextNewcomerSlot, resetAccount } from "./helpers/inbox";

// Open AuthSuitcase on every signed-out state (#424), in every theme, reached through a real Settings choice and sign-out
// (#283). Axe runs in every theme at 1280 and in one theme at 390. AUTH_SHOTS=<folder> writes every reviewed state; without
// that opt-in, the suite records no broad screenshot matrix.
const THEMES = ["ocean", "evergreen", "dusk"] as const;
const SHOTS = process.env.AUTH_SHOTS;
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
  test(`${theme} at ${width}px: every signed-out screen uses AuthSuitcase`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    // A real sign-out, not a hand-set cookie (#283): choose the theme in Settings, press Sign out, and review what the
    // signed-out screens then render.
    const palette = PALETTES.find((candidate) => candidate.id === theme)!;
    await signInAsOwner(page);
    await chooseThemeAndSignOut(page, page.context(), palette);

    const check = async (name: string) => {
      await expect(page.locator("html")).toHaveAttribute("data-scheme", theme);
      // The brand-only bar has the app's suitcase mark and no interactive content.
      const bar = page.locator("header.auth-brandbar");
      await expect(bar).toBeVisible();
      await expect(bar.getByText("Packed Smart")).toBeVisible();
      await expect(bar.getByRole("link")).toHaveCount(0);
      await expect(bar.getByRole("button")).toHaveCount(0);
      // The decorative lid never adds a second heading or accessibility noise. The panel is flat inside the case.
      const suitcase = page.locator(".auth-suitcase");
      const lid = page.locator(".auth-lid");
      const card = page.locator(".auth-card");
      await expect(suitcase).toBeVisible();
      await expect(lid).toHaveAttribute("aria-hidden", "true");
      await expect(lid).toContainText("READY TOGO!");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(card).toHaveCSS("border-top-width", "0px");
      await expect(card).toHaveCSS("box-shadow", "none");
      const lidBox = (await lid.boundingBox())!;
      const panelBox = (await page.locator(".auth-panel").boundingBox())!;
      if (width < 1024) expect(panelBox.y, `${name}: panel below lid`).toBeGreaterThan(lidBox.y);
      else expect(panelBox.x, `${name}: panel beside lid`).toBeGreaterThan(lidBox.x);
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

test("AuthSuitcase geometry holds from 195px through 1440px", async ({ page }) => {
  for (const [width, cubeCount] of [
    [195, 3],
    [320, 3],
    [390, 4],
    [768, 5],
    [1024, 5],
    [1440, 5],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    expect(await sidewaysScroll(page), `${width}: no sideways scroll`).toBeLessThanOrEqual(0);
    expect(
      await page
        .locator(".auth-cube")
        .evaluateAll(
          (cubes) => cubes.filter((cube) => getComputedStyle(cube).display !== "none").length,
        ),
      `${width}: responsive cube count`,
    ).toBe(cubeCount);
    for (const selector of [".auth-suitcase", ".auth-lid", ".auth-panel"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x, `${width}: ${selector} starts in viewport`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${width}: ${selector} ends in viewport`).toBeLessThanOrEqual(
        width + 0.5,
      );
    }
  }
});
