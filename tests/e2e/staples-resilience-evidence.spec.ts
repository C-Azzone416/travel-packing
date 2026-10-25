import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appearanceName, type Appearance } from "../../src/domain/appearance";
import { ownerEmailFor, signIn } from "./helpers/auth";
import { resetOwnerData, setOwnerAppearance, setStaplesSetupLifecycle } from "./helpers/database";

// Opt-in rendered evidence for the two resilience states added during #223 review.
// STAPLES_RESILIENCE_SHOTS=<folder> writes only Design's four requested synthetic screenshots.
const SHOTS = process.env.STAPLES_RESILIENCE_SHOTS;

async function chooseThemeThroughSettings(page: Page, theme: Appearance) {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await page.getByRole("radio", { name: new RegExp(appearanceName(theme)) }).check();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
  await expect(page.getByText(`Current theme: ${appearanceName(theme)}`)).toBeVisible();
  await expect(page.getByText(/^Last saved /)).toBeVisible();
}

async function abortNextAction(page: Page) {
  let aborted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!aborted && request.method() === "POST" && new URL(request.url()).pathname === "/") {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
}

test("captures the reviewed Staples resilience states", async ({ page }, testInfo) => {
  test.skip(!SHOTS, "Set STAPLES_RESILIENCE_SHOTS to generate the design-review evidence.");
  test.skip(testInfo.project.name !== "desktop", "One browser renders all four requested cells.");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  mkdirSync(SHOTS!, { recursive: true });

  const email = ownerEmailFor("desktop");
  const ownerId = `e2e-${email}`;
  await resetOwnerData(ownerId);
  await setOwnerAppearance(ownerId, "violet");
  await signIn(page, email);

  const loadFailureCells: readonly { theme: Appearance; width: 1280 | 390 }[] = [
    { theme: "base", width: 1280 },
    { theme: "ocean", width: 390 },
  ];
  for (const { theme, width } of loadFailureCells) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await chooseThemeThroughSettings(page, theme);
    await abortNextAction(page);
    await page.goto("/");
    await expect(page.getByRole("status", { name: "Staples setup unavailable" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your travel ledger" })).toBeVisible();
    await page.screenshot({
      path: join(SHOTS!, `${theme}-${width}-setup-read-failure.png`),
      fullPage: true,
    });
    await page.unroute("**/*");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your travel ledger" })).toBeVisible();
  }

  const dismissFailureCells: readonly { theme: Appearance; width: 1280 | 390 }[] = [
    { theme: "violet", width: 1280 },
    { theme: "terracotta", width: 390 },
  ];
  for (const { theme, width } of dismissFailureCells) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setStaplesSetupLifecycle(ownerId, "completed");
    await page.reload();
    await chooseThemeThroughSettings(page, theme);
    await setStaplesSetupLifecycle(ownerId, "skipped");
    await page.goto("/");
    const reminder = page.getByRole("complementary", { name: "Staples setup reminder" });
    await expect(reminder).toBeVisible();
    await page.waitForLoadState("networkidle");
    await abortNextAction(page);
    await reminder.getByRole("button", { name: "Don’t remind me" }).click();
    await expect(reminder.getByRole("alert")).toContainText("Couldn’t update your reminder.");
    await page.screenshot({
      path: join(SHOTS!, `${theme}-${width}-reminder-dismiss-error.png`),
      fullPage: true,
    });
    await page.unroute("**/*");
  }
});
