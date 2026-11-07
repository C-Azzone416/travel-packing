import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import { expectAccessible } from "./helpers/a11y";
import { expectPacking } from "./helpers/packing";
import { planRouteToList, reviewAndCreate } from "./helpers/plan";

// The ledger Home is drawn below 1024px (the laptop Home is #431, the phone Home #388): this spec's flow starts there, so it runs
// there. The trip page below 1024px is the phone Pack mode.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

// Per-trip stamp label (#151), through the real data layer: the packing screen's Edit stamp sheet, the same label on the
// dashboard (display only), Reset to automatic, and what a person typing a bad label sees.
const NOW = new Date("2026-10-16T12:00:00");

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
}
// The stamp is drawn on the dashboard (the Packing screen only has the Edit stamp link, under the suitcase).
const dashboardStamp = (page: Page, trip: string) =>
  page.getByRole("article", { name: trip }).getByRole("img", { name: /stamps?$/ });
async function stampOnDashboard(page: Page, trip: string) {
  await page.goto("/");
  return dashboardStamp(page, trip);
}
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
  const automatic = await (await stampOnDashboard(page, "San Diego")).getAttribute("aria-label");
  expect(automatic).toMatch(/departure stamp$/);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);

  const sheet = await openStampSheet(page);
  await expect(sheet.getByRole("group", { name: "Stamp 1, automatic" })).toBeVisible();
  await sheet.getByRole("radio", { name: "Custom" }).check();
  const field = sheet.getByRole("textbox", { name: "Label", exact: true });
  await field.fill("sd7");
  await expect(field).toHaveValue("SD7");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Stamp updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit stamp" })).toBeFocused();

  // It is stored: after a reload the dashboard shows the label, with no way to edit it there.
  await page.reload();
  await page.goto("/");
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
  await expect(await stampOnDashboard(page, "San Diego")).toHaveAttribute("aria-label", automatic!);
});

test("a two-country trip has two stamps to label: each is edited on its own, and the name carries both", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await planRouteToList(
    page,
    [
      { query: "lisbon", option: /Lisbon/ },
      { query: "paris", option: /Paris/ },
    ],
    ["2026-11-12", "2026-11-15", "2026-11-18"],
  );
  await reviewAndCreate(page);
  await page
    .getByRole("article", { name: "Lisbon → Paris" })
    .getByRole("link", { name: /(Continue|Keep) packing/ })
    .click();
  await expectPacking(page);

  const sheet = await openStampSheet(page);
  await expect(sheet.getByRole("group", { name: "Stamp 1, automatic" })).toBeVisible();
  const second = sheet.getByRole("group", { name: /^Stamp 2,/ });
  await expect(second.getByText("FRA, the country code for France")).toBeVisible();
  await second.getByRole("radio", { name: "Custom" }).check();
  await second.getByRole("textbox", { name: "Label", exact: true }).fill("zz9");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expectPacking(page);
  const again = await openStampSheet(page);
  await expect(
    again
      .getByRole("group", { name: /^Stamp 2,/ })
      .getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("ZZ9");
});

test("a label that is not exactly 3 letters or numbers is refused with a message, and nothing is saved", async ({
  page,
}) => {
  await openSanDiego(page);
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
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit stamp" })).toBeFocused();
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
