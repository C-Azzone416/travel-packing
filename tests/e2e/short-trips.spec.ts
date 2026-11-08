import { expect, test } from "@playwright/test";
import { DAY, NEXT_DAY, create, planAndOpen } from "./helpers/short-trip";

// Short trips (#412, spec #393 section 3): a day trip and a one-night trip, planned through the real flow with FIXED dates, then
// seen on the laptop Packing view (1280) and the phone Pack mode (390). Singular copy, a single date, no Morning of on a day
// trip, the laundry control only where it changes a quantity, and the Edit trip row disabled with its reason.

for (const width of [1280, 390]) {
  const laptop = width >= 1024;

  test(`a day trip at ${width}: no laundry control, no Morning of, nothing says 0 nights`, async ({
    page,
  }) => {
    test.skip(test.info().project.name === "phone", "the width is set per test, on desktop");
    await planAndOpen(page, DAY, DAY);
    // Starting list: laundry changes nothing on a day trip, so its card is not offered.
    await expect(page.getByText(/I’ll have laundry/)).toHaveCount(0);
    await expect(
      page.getByText("Underwear, socks and other per-day items counted for a day trip"),
    ).toBeVisible();
    await create(page, width);
    await expect(page.getByRole("button", { name: /^Laundry/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit list" }).click();
    await expect(page.getByRole("switch", { name: /Morning of/ })).toHaveCount(0);
    await expect(page.getByText("Morning of")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("0 nights");
    if (laptop) {
      // Edit trip: one date for both ends, "−" stops at a day trip, the laundry row is disabled and says why.
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Edit trip" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Edit trip" });
      await expect(dialog.getByLabel("Leave", { exact: true })).toHaveValue(DAY);
      await expect(dialog.getByLabel("Come home")).toHaveValue(DAY);
      await expect(dialog.getByText("5 Dec", { exact: true })).toBeVisible();
      await expect(dialog.getByText("day trip", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "One night fewer" })).toBeDisabled();
      await dialog.getByRole("button", { name: /Packing preferences/ }).click();
      await expect(dialog.getByRole("switch", { name: "Laundry on this trip" })).toBeDisabled();
      await expect(dialog.getByText("No effect on a trip this short.")).toBeVisible();
    }
  });

  test(`a one-night trip at ${width}: singular copy, Morning of stays`, async ({ page }) => {
    test.skip(test.info().project.name === "phone", "the width is set per test, on desktop");
    await planAndOpen(page, DAY, NEXT_DAY);
    await create(page, width);
    await expect(page.locator("body")).not.toContainText("1 nights");
    await expect(page.locator("body")).not.toContainText("0 nights");
    await page.getByRole("button", { name: "Edit list" }).click();
    await expect(page.getByRole("switch", { name: /Morning of/ })).toBeVisible();
    if (laptop) {
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Edit trip" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Edit trip" });
      await expect(dialog.getByText("1 night", { exact: true })).toBeVisible();
    }
  });
}
