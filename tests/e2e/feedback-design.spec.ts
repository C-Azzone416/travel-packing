import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { connectFeedback, fakeFramebriar, goToTrips } from "./helpers/feedback";

const THEMES = ["base", "ocean", "terracotta", "violet"] as const;
const WIDTHS = [390, 1280] as const;
const SHOTS = process.env.FEEDBACK_DESIGN_SHOTS;

async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
  await page.context().addCookies([
    {
      name: "appearance",
      value: theme,
      url: test.info().project.use.baseURL ?? "http://localhost",
    },
  ]);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`${theme} feedback at ${width}px has an accessible header control, form and sheet`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      // A short enrollment, so the notice at the end is the real "expired" state.
      await fakeFramebriar.reset();
      await fakeFramebriar.setEnrollmentMs(6000);
      await useTheme(page, theme);

      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
      const invitation = page.getByLabel("Invitation");
      await expect(invitation.locator("xpath=..")).toHaveClass(/\bfield\b/);
      await connectFeedback(page);
      await goToTrips(page);

      const feedback = page.getByRole("button", { name: "Send feedback" });
      await expect(feedback).toBeVisible();
      await expectAccessible(page, `${theme} ${width} feedback button`);
      await shot(page, `${theme}-${width}-button`);

      await feedback.click();
      const dialog = page.getByRole("dialog", { name: "Send feedback" });
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Send" })).toBeVisible();
      if (width === 390) {
        const thumbnail = dialog.getByRole("img", { name: "Screenshot of the screen you were on" });
        await expect(thumbnail).toBeVisible();
        expect((await thumbnail.boundingBox())?.height).toBeLessThanOrEqual(120);
      }
      await expectAccessible(page, `${theme} ${width} feedback sheet`);
      await shot(page, `${theme}-${width}-sheet`);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await expect(async () => {
        await page.reload();
        await expect(page.locator(".feedback-notice")).toContainText(
          "Your feedback access has expired.",
          { timeout: 1500 },
        );
      }).toPass({ timeout: 30_000 });
      await expectAccessible(page, `${theme} ${width} feedback notice`);
      await shot(page, `${theme}-${width}-notice`);
    });
  }
}
