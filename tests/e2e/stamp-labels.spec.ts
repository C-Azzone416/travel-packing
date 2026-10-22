import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { expectAccessible } from "./helpers/a11y";

// Per-trip stamp label (#151), through the real data layer: the packing screen's Edit stamp sheet, the same label on the
// dashboard (display only), Reset to automatic, and what a person typing a bad label sees.
const NOW = new Date("2026-10-16T12:00:00");

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}
const heroStamp = (page: Page) => page.locator(".hero-stamps").getByRole("img");
/** Open the sheet; a click that lands before the page is interactive is repeated until the sheet shows. */
async function openStampSheet(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Stamp label" });
  await expect(async () => {
    await page.getByRole("button", { name: "Edit stamp" }).click();
    await expect(sheet).toBeVisible({ timeout: 1000 });
  }).toPass();
  return sheet;
}

test("set a custom stamp label, see it on the dashboard and after a reload, then reset it to automatic", async ({
  page,
}) => {
  await openSanDiego(page);
  const automatic = await heroStamp(page).getAttribute("aria-label");
  expect(automatic).toMatch(/departure stamp$/);

  const sheet = await openStampSheet(page);
  await expect(sheet.getByRole("group", { name: "Stamp 1, automatic" })).toBeVisible();
  await sheet.getByRole("radio", { name: "Custom" }).check();
  const field = sheet.getByRole("textbox", { name: "Label", exact: true });
  await field.fill("sd7");
  await expect(field).toHaveValue("SD7");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Stamp updated.")).toBeVisible();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", "SD7, San Diego, departure stamp");
  await expect(page.getByRole("button", { name: "Edit stamp" })).toBeFocused();

  // It is stored: a reload shows it, and the dashboard shows the same label with no way to edit it there.
  await page.reload();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", "SD7, San Diego, departure stamp");
  await page.getByRole("link", { name: "All trips" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "San Diego" })
      .getByRole("img", { name: "SD7, San Diego, departure stamp" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit stamp" })).toHaveCount(0);

  // Reset to automatic restores the derived label.
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  const reset = await openStampSheet(page);
  await reset.getByRole("button", { name: "Reset to automatic" }).click();
  await reset.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Stamp reset to automatic.")).toBeVisible();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", automatic!);
});

test("a two-country trip has two stamps to label: each is edited on its own, and the name carries both", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
  await page.getByRole("option", { name: /Lisbon/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-15");
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await page.getByRole("combobox", { name: "Destination search, Stop 2" }).fill("paris");
  await page.getByRole("option", { name: /Paris/ }).click();
  await page.getByLabel("Leave, Stop 2").fill("2026-11-18");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("article", { name: "Lisbon → Paris" })
    .getByRole("link", { name: /(Continue|Keep) packing/ })
    .click();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", "PRT, FRA route stamps");

  const sheet = await openStampSheet(page);
  await expect(sheet.getByRole("group", { name: "Stamp 1, automatic" })).toBeVisible();
  const second = sheet.getByRole("group", { name: /^Stamp 2,/ });
  await expect(second.getByText("FRA, the country code for France")).toBeVisible();
  await second.getByRole("radio", { name: "Custom" }).check();
  await second.getByRole("textbox", { name: "Label", exact: true }).fill("zz9");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", "PRT, ZZ9 route stamps");
  await page.reload();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", "PRT, ZZ9 route stamps");
});

test("a label that is not exactly 3 letters or numbers is refused with a message, and nothing is saved", async ({
  page,
}) => {
  await openSanDiego(page);
  const automatic = await heroStamp(page).getAttribute("aria-label");
  const sheet = await openStampSheet(page);
  await sheet.getByRole("radio", { name: "Custom" }).check();
  const field = sheet.getByRole("textbox", { name: "Label", exact: true });
  await field.fill("ab");
  await field.blur();
  await expect(sheet.getByText("Use exactly 3 letters or numbers (A–Z, 0–9).")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  // Not saveable while it is invalid.
  await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(heroStamp(page)).toHaveAttribute("aria-label", automatic!);
});

test(
  "the Stamp label sheet is accessible, keyboard operable, and fits a phone",
  DEVICE,
  async ({ page }) => {
    await openSanDiego(page);
    const edit = page.getByRole("button", { name: "Edit stamp" });
    const box = (await edit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.9);
    await edit.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Stamp label" });
    await expect(sheet).toBeVisible();
    await expectAccessible(page, "stamp sheet, automatic", { include: '[role="dialog"]' });
    await sheet.getByRole("radio", { name: "Custom" }).check();
    await sheet.getByRole("textbox", { name: "Label", exact: true }).fill("a1b");
    await expectAccessible(page, "stamp sheet, custom", { include: '[role="dialog"]' });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(edit).toBeFocused();
  },
);
