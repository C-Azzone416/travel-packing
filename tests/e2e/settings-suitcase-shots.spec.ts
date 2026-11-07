import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { setOwnerAppearance } from "./helpers/database";
import { OWNER_EMAIL, signIn } from "./helpers/auth";

const SHOTS = process.env.SETTINGS_SUITCASE_SHOTS;
test.skip(!SHOTS, "set SETTINGS_SUITCASE_SHOTS=<folder> to render the #413 review set");

async function shot(page: import("@playwright/test").Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: "disabled" });
}

test("focused exact-head Settings suitcase review set", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/$/);

  for (const scheme of ["ocean", "evergreen", "dusk"] as const) {
    await setOwnerAppearance(`e2e-${OWNER_EMAIL}`, scheme);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
    await page.setViewportSize({ width: 1280, height: 980 });
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await shot(page, `settings-${scheme}-1280x980`);
  }

  await setOwnerAppearance(`e2e-${OWNER_EMAIL}`, "ocean");
  for (const size of [
    { width: 768, height: 900, tag: "768x900" },
    { width: 390, height: 844, tag: "390x844" },
    { width: 195, height: 844, tag: "195x844" },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await shot(page, `settings-ocean-${size.tag}`);
  }
});
