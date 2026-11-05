import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";

// Rendered screenshots of the redesigned Staples screen (#384) for design's review, next to the design images. Run with
// STAPLES_REDESIGN_SHOTS=<folder>; without it these are skipped. Laptop: the list, and the list with a row's inline editor
// open. Phone: the list (laundry off, as in st-p) and the bottom sheet. Widths 1280, 390 and 195, in all three schemes.
const SHOTS = process.env.STAPLES_REDESIGN_SHOTS;
const THEMES = ["ocean", "evergreen", "dusk"] as const;
// `expand`: open the phone dock for the shot (st-p shows it open); the others show its default (collapsed on a short or narrow screen).
const SIZES = [
  { width: 1280, height: 1000, tag: "1280", expand: false },
  { width: 390, height: 844, tag: "390", expand: true },
  { width: 390, height: 640, tag: "390x640", expand: false },
  { width: 195, height: 844, tag: "195", expand: false },
] as const;

test.skip(!SHOTS, "set STAPLES_REDESIGN_SHOTS=<folder> to render the design screenshots");

async function shot(page: Page, name: string, fullPage: boolean) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

for (const theme of THEMES) {
  for (const { width, height, tag: size, expand } of SIZES) {
    const tag = `${theme}-${size}`;
    test(`${tag}: the Staples screen`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
      await signInAsOwner(page);
      await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
      await page.context().addCookies([
        {
          name: "appearance",
          value: theme,
          url: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
        },
      ]);
      await page.goto("/staples");
      await expect(page.getByRole("region", { name: "Clothing" })).toBeVisible();

      // A staple that scales and is marked ↻, like the design's Tees.
      await page.getByRole("textbox", { name: "Staple name" }).fill("Tees");
      await page.getByRole("button", { name: "Add staple" }).click();
      const laptop = width >= 1024;
      const toast = page.getByText("Tees saved for future trips.");
      if (laptop) await expect(toast).toBeHidden({ timeout: 15_000 });
      if (!laptop) {
        const sheet = page.getByRole("dialog", { name: "Tees" });
        await expect(sheet).toBeVisible();
        await sheet.getByRole("button", { name: "per day" }).click();
        await sheet.getByRole("switch", { name: "Fewer with laundry" }).click();
        await shot(page, `${tag}-sheet`, false);
        await sheet.getByRole("button", { name: "Done" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(toast).toBeHidden({ timeout: 15_000 });
      } else {
        const row = page.locator("[data-staple-id]").filter({ hasText: "Tees" });
        await expect(row).toBeVisible();
        await row.getByRole("button", { name: /^Tees/ }).click();
        const editor = page.getByRole("group", { name: "Edit Tees" });
        await editor.getByRole("button", { name: "per day" }).click();
        await editor.getByRole("switch", { name: "Fewer with laundry" }).click();
        await expect(row.locator("ins")).toHaveText("× 3");
        await shot(page, `${tag}-editor`, true);
        await row.getByRole("button", { name: /^Tees/ }).click();
      }
      if (!laptop) {
        // st-p shows the laundry switch off in the dock.
        const dock = page.getByRole("button", { name: /^Preview:/ });
        if (expand) {
          if ((await dock.getAttribute("aria-expanded")) === "false") await dock.click();
          await page.getByRole("switch", { name: "Laundry on the trip" }).uncheck();
        } else {
          // The default: collapsed on a screen under 700px tall or 360px wide, so the list stays usable.
          await expect(dock).toHaveAttribute("aria-expanded", "false");
        }
      }
      await page.waitForTimeout(300);
      await shot(page, `${tag}-list`, laptop);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
