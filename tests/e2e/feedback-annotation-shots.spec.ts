import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import {
  connectFeedback,
  fakeFramebriar,
  goToTrips,
  openSettingsFromNav,
} from "./helpers/feedback";

// Rendered screenshots of the annotation editor for design review (#266, the spec's section 7). Run with
// FEEDBACK_ANNOTATION_SHOTS=<folder>; without it these are skipped. The screen capture is replaced by a SYNTHETIC picture (a light or
// a dark one with a few shapes), so the ink edges can be judged on both and nothing real is in any image.
const SHOTS = process.env.FEEDBACK_ANNOTATION_SHOTS;
const THEMES = ["base", "ocean", "terracotta", "violet"] as const;
const WIDTHS = [390, 1280] as const;
const CANVAS = /^Your screenshot\. Marks you draw are sent with it/;
const INKS = ["Black", "Red", "Blue", "Yellow"] as const;

test.skip(!SHOTS, "set FEEDBACK_ANNOTATION_SHOTS=<folder> to render the design screenshots");

async function synthetic(
  page: Page,
  options: { tone: "light" | "dark"; oversize?: "alone" | "marks"; slowMs?: number },
) {
  await page.addInitScript((config) => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let made = 0;
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback,
      type,
      quality,
    ) {
      made += 1;
      const first = made === 1;
      const finish = (blob: Blob | null) => {
        const pad =
          (config.oversize === "alone" && first) || (config.oversize === "marks" && !first);
        const out =
          blob && pad ? new Blob([blob, new Uint8Array(4_300_000)], { type: "image/png" }) : blob;
        if (!first && config.slowMs) setTimeout(() => callback(out), config.slowMs);
        else callback(out);
      };
      if (!first) return original.call(this, finish, type, quality);
      // The capture: draw a made-up screen of the same size instead of the real one.
      const fake = document.createElement("canvas");
      fake.width = this.width;
      fake.height = this.height;
      const context = fake.getContext("2d")!;
      const dark = config.tone === "dark";
      context.fillStyle = dark ? "#16181d" : "#f6f1e6";
      context.fillRect(0, 0, fake.width, fake.height);
      context.fillStyle = dark ? "#2a2f38" : "#e4dcc8";
      context.fillRect(0, 0, fake.width, Math.round(fake.height * 0.09));
      for (let row = 0; row < 6; row += 1) {
        context.fillStyle = dark ? "#262b33" : "#fffaf0";
        context.fillRect(
          fake.width * 0.06,
          fake.height * (0.16 + row * 0.13),
          fake.width * 0.88,
          fake.height * 0.1,
        );
        context.fillStyle = dark ? "#8b93a1" : "#7d857c";
        context.fillRect(
          fake.width * 0.1,
          fake.height * (0.195 + row * 0.13),
          fake.width * (0.3 + 0.06 * row),
          fake.height * 0.012,
        );
      }
      return original.call(fake, finish, type, quality);
    };
  }, options);
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function stroke(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const rect = canvasElement.getBoundingClientRect();
    const scale = Math.min(rect.width / canvasElement.width, rect.height / canvasElement.height);
    const width = canvasElement.width * scale;
    const height = canvasElement.height * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  });
  await page.mouse.move(box.left + box.width * from[0], box.top + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.left + box.width * to[0], box.top + box.height * to[1], { steps: 14 });
  await page.mouse.up();
}

async function open(page: Page, theme: (typeof THEMES)[number], width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fakeFramebriar.reset();
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
  await page
    .context()
    .addCookies([{ name: "appearance", value: theme, url: "http://localhost:3100" }]);
  await openSettingsFromNav(page);
  await connectFeedback(page);
  await goToTrips(page);
  // The "Connected" toast is not part of the sheet; let it go before the picture is taken.
  await expect(page.getByText("Connected. Feedback is on.")).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "Send feedback" }).click();
  return page.getByRole("dialog", { name: "Send feedback" });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const tag = `${theme}-${width}`;

    test(`${tag}: the editor, marks in each ink on a light and a dark picture, cleared, text only`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "light" });
      const dialog = await open(page, theme, width);
      const canvas = dialog.getByRole("img", { name: CANVAS });
      await expect(canvas).toBeVisible();
      await dialog.getByLabel("What happened?").fill("The count at the top looks wrong");
      await shot(page, `${tag}-1-opened`);

      for (const [index, ink] of INKS.entries()) {
        await dialog.getByRole("radio", { name: new RegExp(ink) }).click();
        const y = 0.2 + index * 0.17;
        await stroke(page, canvas, [0.12, y], [0.88, y + 0.06]);
      }
      await expect(dialog.locator(".shot-status")).toHaveText("4 marks.");
      await shot(page, `${tag}-2-marks-light`);

      await dialog.getByRole("button", { name: "Clear drawing" }).click();
      await expect(dialog.locator(".shot-status")).toHaveText(
        "Drawing cleared. Undo brings it back.",
      );
      await shot(page, `${tag}-3-cleared`);
      await dialog.getByRole("button", { name: "Undo" }).click();

      await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
      await shot(page, `${tag}-4-text-only`);
    });

    test(`${tag}: marks on a dark picture`, async ({ page }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "dark" });
      const dialog = await open(page, theme, width);
      const canvas = dialog.getByRole("img", { name: CANVAS });
      await expect(canvas).toBeVisible();
      for (const [index, ink] of INKS.entries()) {
        await dialog.getByRole("radio", { name: new RegExp(ink) }).click();
        const y = 0.2 + index * 0.17;
        await stroke(page, canvas, [0.12, y], [0.88, y + 0.06]);
      }
      await shot(page, `${tag}-2-marks-dark`);
    });

    test(`${tag}: too large with marks, and too large on its own`, async ({ page }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "light", oversize: "marks" });
      const dialog = await open(page, theme, width);
      await stroke(page, dialog.getByRole("img", { name: CANVAS }), [0.15, 0.4], [0.85, 0.5]);
      await dialog.getByLabel("What happened?").fill("Too much ink");
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(
        dialog.getByRole("alert").filter({ hasText: /Your screenshot with marks/ }),
      ).toBeVisible();
      await shot(page, `${tag}-5-oversize-marks`);
    });

    test(`${tag}: too large on its own`, async ({ page }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "light", oversize: "alone" });
      const dialog = await open(page, theme, width);
      await dialog.getByLabel("What happened?").fill("Big picture");
      await expect(
        dialog.getByRole("alert").filter({ hasText: /^⚠ This screenshot is/ }),
      ).toBeVisible();
      await shot(page, `${tag}-5-oversize-alone`);
    });

    test(`${tag}: saving, tools off`, async ({ page }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "light", slowMs: 4000 });
      const dialog = await open(page, theme, width);
      await stroke(page, dialog.getByRole("img", { name: CANVAS }), [0.2, 0.5], [0.8, 0.55]);
      await dialog.getByLabel("What happened?").fill("Saving state");
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(dialog.getByRole("button", { name: "Saving…" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Undo" })).toBeDisabled();
      await shot(page, `${tag}-7-saving`);
    });
  }
}

test.describe("with the keyboard open", () => {
  for (const theme of THEMES) {
    test(`${theme}-390: the notes and the footer in a 340px tall screen`, async ({ page }) => {
      test.setTimeout(120_000);
      await synthetic(page, { tone: "light" });
      const dialog = await open(page, theme, 390);
      await page.setViewportSize({ width: 390, height: 340 });
      await dialog.getByLabel("What happened?").focus();
      await expect(async () => {
        const box = await dialog.getByRole("button", { name: "Send" }).boundingBox();
        expect(box && box.y + box.height <= 340).toBe(true);
      }).toPass({ timeout: 5000 });
      await shot(page, `${theme}-390-6-keyboard`);
    });
  }
});
