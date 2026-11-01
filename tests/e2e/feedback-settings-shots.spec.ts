import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { connectFeedback, fakeFramebriar, openSettingsFromNav } from "./helpers/feedback";

// Rendered screenshots for design's review of Feedback from Settings (#273, the spec's section 5). Run with
// FEEDBACK_SETTINGS_SHOTS=<folder>; without it these are skipped. Each state shows Settings itself and the screenshot the sheet
// produces from it (the sheet's preview is the real sanitised capture).
const SHOTS = process.env.FEEDBACK_SETTINGS_SHOTS;
const THEMES = ["base", "ocean", "terracotta", "violet"] as const;
const WIDTHS = [390, 1280] as const;
const CANVAS = /^Your screenshot\. Marks you draw are sent with it/;

test.skip(!SHOTS, "set FEEDBACK_SETTINGS_SHOTS=<folder> to render the design screenshots");

async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function start(page: Page, theme: (typeof THEMES)[number], width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fakeFramebriar.reset();
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
  await page
    .context()
    .addCookies([{ name: "appearance", value: theme, url: "http://localhost:3100" }]);
}

async function toAccount(page: Page, block: "start" | "center" = "start") {
  await page
    .getByRole("heading", { name: "Account", level: 2 })
    .evaluate((h, where) => h.scrollIntoView({ block: where, behavior: "instant" }), block);
  await page.waitForTimeout(300);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const tag = `${theme}-${width}`;

    test(`${tag}: connected: the card action, the header button, and the picture the sheet makes`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await start(page, theme, width);
      await openSettingsFromNav(page);
      await connectFeedback(page);
      await expect(page.getByText("Connected. Feedback is on.")).toHaveCount(0, {
        timeout: 15_000,
      });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await shot(page, `${tag}-1-settings-connected-top`);
      await page.locator(".feedback-send-action").scrollIntoViewIfNeeded();
      await shot(page, `${tag}-2-settings-connected-card`);
      await shot(page, `${tag}-2b-settings-connected-full`, true);

      // The picture the sheet makes: Account card at the top of the screen, so it and the cards under it are in the picture.
      await toAccount(page, "start");
      await shot(page, `${tag}-3-settings-scrolled-account`);
      await page.locator(".feedback-button").evaluate((button) => (button as HTMLElement).click());
      const dialog = page.getByRole("dialog", { name: "Send feedback" });
      await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
      await shot(page, `${tag}-4-sheet-from-settings`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    test(`${tag}: a visible error state, then the sheet`, async ({ page }) => {
      test.setTimeout(120_000);
      await start(page, theme, width);
      await openSettingsFromNav(page);
      await connectFeedback(page);
      await expect(page.getByText("Connected. Feedback is on.")).toHaveCount(0, {
        timeout: 15_000,
      });
      await fakeFramebriar.setOffline(true);
      await page.getByRole("button", { name: "Disconnect" }).click();
      await page
        .getByRole("group", { name: "Disconnect feedback" })
        .getByRole("button", { name: "Disconnect" })
        .click();
      await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
      await toAccount(page, "start");
      await shot(page, `${tag}-5-settings-error`);
      await page.locator(".feedback-button").evaluate((button) => (button as HTMLElement).click());
      const dialog = page.getByRole("dialog", { name: "Send feedback" });
      await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
      await shot(page, `${tag}-6-sheet-error`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    test(`${tag}: something private open: no picture, the notes still go`, async ({ page }) => {
      test.setTimeout(120_000);
      await start(page, theme, width);
      await openSettingsFromNav(page);
      await connectFeedback(page);
      await expect(page.getByText("Connected. Feedback is on.")).toHaveCount(0, {
        timeout: 15_000,
      });
      await page.evaluate(() => {
        const portal = document.createElement("div");
        portal.setAttribute("data-feedback-sensitive-portal", "");
        document.body.append(portal);
      });
      await page.locator(".feedback-button").evaluate((button) => (button as HTMLElement).click());
      const dialog = page.getByRole("dialog", { name: "Send feedback" });
      await expect(dialog.locator(".feedback-no-shot")).toBeVisible();
      await dialog.getByLabel("What happened?").fill("Something private was open");
      await shot(page, `${tag}-7-sheet-private`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    test(`${tag}: not connected, and unavailable: no card action, header dimmed`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await start(page, theme, width);
      await openSettingsFromNav(page);
      await expect(page.getByLabel("Invitation")).toBeVisible();
      await expect(page.locator(".feedback-send-action")).toHaveCount(0);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await shot(page, `${tag}-8-settings-needs-connect-top`);
      await page.locator("#settings-feedback").scrollIntoViewIfNeeded();
      await shot(page, `${tag}-8b-settings-needs-connect-card`);

      // The service cannot be reached: the card says so, still no action, header dimmed.
      await page.route("**/api/feedback/enrollment", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                v: 1,
                status: "unavailable",
                expiresAt: null,
                redemption: "none",
                hasRecord: false,
                outboxKey: null,
              }),
            })
          : route.fallback(),
      );
      await page.reload();
      await expect(page.locator(".feedback-send-action")).toHaveCount(0);
      await expect(page.locator(".feedback-button")).toBeDisabled();
      await page.locator("#settings-feedback").scrollIntoViewIfNeeded();
      await shot(page, `${tag}-9-settings-unavailable`);
    });
  }
}
