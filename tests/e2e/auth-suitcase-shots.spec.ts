import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { OWNER_EMAIL, signIn } from "./helpers/auth";
import { ANONYMOUS_COOKIE } from "./helpers/appearance";

// Focused rendered evidence for the AuthSuitcase handoff (#424). This is opt-in so normal CI writes no screenshots.
// It deliberately avoids the old state × scheme matrix: all responsive cells use Ocean, while Evergreen and Dusk each
// get one laptop parity image. Error placement and one other AuthShell screen are the only additional states.
const SHOTS = process.env.AUTH_SUITCASE_SHOTS;
test.skip(!SHOTS, "set AUTH_SUITCASE_SHOTS=<folder> to render the #424 review screenshots");

type Scheme = "ocean" | "evergreen" | "dusk";

async function setScheme(context: BrowserContext, baseURL: string, scheme: Scheme) {
  await context.clearCookies({ name: ANONYMOUS_COOKIE });
  await context.addCookies([
    {
      name: ANONYMOUS_COOKIE,
      value: scheme,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function expectCleanFrame(page: Page, scheme: Scheme) {
  await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
  await expect(page.locator(".auth-suitcase")).toBeVisible();
  await expect(page.locator(".auth-lid")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function screenshot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
}

test("the compact #424 AuthSuitcase review set", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const responsive = [
    { width: 1280, height: 980, tag: "1280x980" },
    { width: 768, height: 900, tag: "768x900" },
    { width: 390, height: 844, tag: "390x844" },
    { width: 195, height: 844, tag: "195x844" },
    { width: 390, height: 600, tag: "390x600-short" },
  ] as const;

  await setScheme(context, baseURL!, "ocean");
  for (const size of responsive) {
    await page.setViewportSize(size);
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    await expectCleanFrame(page, "ocean");
    if (size.tag.endsWith("short")) {
      const panel = await page.locator(".auth-panel").evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    }
    await screenshot(page, `auth-ocean-sign-in-${size.tag}`);
  }

  // The brand adds no stop: the first six tabs are the accepted form and help-link order.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  const focusOrder = [
    page.getByLabel("Email"),
    page.getByLabel("Password", { exact: true }),
    page.getByRole("button", { name: "Show password" }),
    page.getByRole("button", { name: "Sign in", exact: true }),
    page.getByRole("link", { name: "Forgot password?" }),
    page.getByRole("link", { name: "Create an account" }),
  ];
  for (const control of focusOrder) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  // AuthShell is retained during client navigation. A scrolled short panel must reset for every linked destination.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/sign-in");
  const panel = page.locator(".auth-panel");
  await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  await panel.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);

  for (const scheme of ["evergreen", "dusk"] as const) {
    await setScheme(context, baseURL!, scheme);
    await page.setViewportSize({ width: 1280, height: 980 });
    await page.goto("/sign-in");
    await expectCleanFrame(page, scheme);
    await screenshot(page, `auth-${scheme}-sign-in-1280x980`);
  }

  await setScheme(context, baseURL!, "ocean");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OWNER_EMAIL, "wrong-password");
  const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  const alert = (await page.locator(".auth-card > [role='alert']").boundingBox())!;
  const email = (await page.getByLabel("Email").boundingBox())!;
  expect(alert.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  expect(alert.y + alert.height).toBeLessThanOrEqual(email.y);
  await expectCleanFrame(page, "ocean");
  await screenshot(page, "auth-ocean-sign-in-error-390x844");

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator(".auth-panel").evaluate((element) => element.scrollTop)).toBe(0);
  await expectCleanFrame(page, "ocean");
  await screenshot(page, "auth-ocean-sign-up-390x844");
});
