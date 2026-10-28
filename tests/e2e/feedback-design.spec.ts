import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { connectFeedback, connectedOnTrips, fakeFramebriar, goToTrips } from "./helpers/feedback";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE } from "./helpers/device";
import { serverActionId } from "./helpers/server-action";

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
      // The Cancel / Send footer is pinned: both are inside the visible screen without scrolling, whatever the theme or size.
      const viewport = page.viewportSize();
      for (const name of ["Cancel", "Send"]) {
        const box = await dialog.getByRole("button", { name }).boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= (viewport?.height ?? 0)).toBe(true);
      }
      const preview = dialog.getByRole("img", { name: /^Your screenshot\. Marks you draw/ });
      await expect(preview).toBeVisible();
      expect((await preview.boundingBox())?.height).toBeLessThanOrEqual(480);
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

test(
  "transient save status keeps Feedback anchored and every visible control usable",
  DEVICE,
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fakeFramebriar.reset();
    await connectedOnTrips(page);

    const feedback = page.getByRole("button", { name: "Send feedback" });
    const feedbackBox = (await feedback.boundingBox())!;
    const feedbackX = Math.round(feedbackBox.x);
    await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Saving" })).toHaveCount(0);

    const archiveAction = serverActionId("src/features/trips/actions.ts", "archiveTripAction");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().headers()["next-action"] === archiveAction) await held;
      await route.continue();
    });

    const archive = chooseFromMenu(page, "San Diego", "Archive");
    const saving = page.getByRole("link", { name: "Saving" });
    await expect(saving).toBeVisible();
    const savingBox = (await saving.boundingBox())!;
    expect(savingBox.height).toBeGreaterThanOrEqual(44);
    expect(savingBox.width).toBeGreaterThanOrEqual(44);
    expect(Math.round((await feedback.boundingBox())!.x)).toBe(feedbackX);

    release();
    await archive;
    const saved = page.getByRole("link", { name: "Saved" });
    await expect(saved).toBeVisible();
    const savedBox = (await saved.boundingBox())!;
    expect(savedBox.height).toBeGreaterThanOrEqual(44);
    expect(savedBox.width).toBeGreaterThanOrEqual(44);
    expect(Math.round((await feedback.boundingBox())!.x)).toBe(feedbackX);

    await expect(saved).toHaveCount(0, { timeout: 3_000 });
    expect(Math.round((await feedback.boundingBox())!.x)).toBe(feedbackX);
    await expectAccessible(page, "transient save status and Feedback header");
  },
);
