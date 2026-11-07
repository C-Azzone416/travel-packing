import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { connectedOnTrips, fakeFramebriar } from "./helpers/feedback";
import { DEVICE } from "./helpers/device";

// The shared ModalSheet (#421, spec #376 part 2 section 8): a bottom sheet through 1023px capped at 640px, and the Feedback sheet
// obeys that cap (its wider editor layout starts at 1024). Pinned footer actions keep the safe-area inset clear.
const SHOTS = process.env.MODAL_SHEET_SHOTS;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openFeedback(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (page.url() === "about:blank") {
    await fakeFramebriar.reset();
    await connectedOnTrips(page);
  } else {
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog.getByRole("button", { name: "Send" })).toBeVisible();
  return dialog;
}

test.describe("shared sheet (#421)", () => {
  test("the Feedback sheet respects the 640px cap through the tablet band", async ({ page }) => {
    for (const width of [601, 768, 1000]) {
      const dialog = await openFeedback(page, { width, height: 900 });
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(640);
      expect(box.width).toBeGreaterThan(560);
      // Centred, and bottom-anchored like the phone sheet.
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(Math.round(box.y + box.height)).toBe(900);
      if (width === 768) await shot(page, "feedback-ocean-768");
      await page.keyboard.press("Escape");
    }
  });

  test("the Feedback sheet is wider than the cap from 1024px", async ({ page }) => {
    const dialog = await openFeedback(page, { width: 1280, height: 900 });
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(700);
  });

  test("pinned footer actions keep the safe-area inset clear", DEVICE, async ({ page }) => {
    const dialog = await openFeedback(page, { width: 390, height: 844 });
    await page.addStyleTag({ content: ":root{--safe-bottom:34px}" });
    const viewport = page.viewportSize()!;
    for (const name of ["Cancel", "Send"]) {
      const box = (await dialog.getByRole("button", { name }).boundingBox())!;
      expect(viewport.height - (box.y + box.height)).toBeGreaterThanOrEqual(34);
    }
    await shot(page, "sheet-ocean-390");
  });

  test("a sheet scrolled to the top of its form at 195px", async ({ page }) => {
    const dialog = await openFeedback(page, { width: 195, height: 640 });
    const form = dialog.locator(".feedback-form");
    // The screenshot editor is wider than 159px at 195 (pre-existing, #332); show the form from its top-left.
    await form.evaluate((el) => el.scrollTo(0, 0));
    await expect(dialog.getByRole("heading", { name: "Send feedback" })).toBeInViewport();
    await shot(page, "sheet-ocean-195-top");
  });
});
