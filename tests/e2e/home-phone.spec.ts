import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

const NOW = new Date("2026-10-16T12:00:00Z");

async function openHome(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await expect(page.getByRole("tablist", { name: "Home sections" })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [195, 390, 640, 1023]) {
  test(
    `${width}: the phone Home has four panels and no page overflow`,
    DEVICE,
    async ({ page }) => {
      await openHome(page, width);
      await expect(page.getByRole("heading", { name: "San Diego" })).toBeVisible();
      await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "home-phone-panel-pack");
      await expect(page.getByRole("list", { name: "Cubes" })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      for (const name of ["Weather", "Future", "Stamps"]) {
        await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
        await expect(page).toHaveURL(new RegExp(`tab=${name.toLowerCase()}`));
        await expect(page.getByRole("tabpanel")).toHaveAttribute(
          "id",
          `home-phone-panel-${name.toLowerCase()}`,
        );
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      }
    },
  );
}

test(
  "the Home pill row has roving keyboard selection and each selected panel is accessible",
  DEVICE,
  async ({ page }) => {
    await openHome(page, 390);
    const pack = page.getByRole("tab", { name: /^Pack/ });
    await pack.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^Weather/ })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "home-phone-panel-weather");
    await expectAccessible(page, "Home phone weather", { disable: ["color-contrast"] });

    await page.getByRole("tab", { name: /^Future/ }).click();
    await expectAccessible(page, "Home phone future", { disable: ["color-contrast"] });
    await page.getByRole("button", { name: /Past trips are with your stamps/ }).click();
    await expect(page.getByRole("tab", { name: /^Stamps/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectAccessible(page, "Home phone stamps", { disable: ["color-contrast"] });
  },
);

test("refresh and Back preserve the requested panel", DEVICE, async ({ page }) => {
  await openHome(page, 390);
  await page.getByRole("tab", { name: /^Future/ }).click();
  await page.reload();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "home-phone-panel-future");
  await page.getByRole("tab", { name: /^Pack/ }).click();
  await page.goBack();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "home-phone-panel-future");
});
