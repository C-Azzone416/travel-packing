import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";

// Edit trip (#203): the route and the packing preferences in one sheet, with a review of what a recalculation does before it is
// applied. Real app, real database. The merge rules themselves are unit-tested (item-ops, recalc-preview); these tests prove the
// sheet shows them truthfully and that the stored list keeps the person's work.
const NOW = new Date("2026-10-16T12:00:00");

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const sheet = (page: Page) => page.getByRole("dialog", { name: "Edit trip" });

/** The sheet's own "Edit preferences" entry (Trip math); a click that lands before the page is interactive is repeated. */
async function openPreferences(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Edit preferences" }).click();
    await expect(sheet(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
  return sheet(page);
}

test("Edit trip has three ways in: the dashboard, the packing hero and Trip math, each on the right tab", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  const hero = page.getByRole("article", { name: "San Diego" });
  await hero.getByRole("button", { name: "Edit trip: San Diego" }).click();
  await expect(sheet(page).getByRole("tab", { name: "Route & dates" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit trip" }).click();
  await expect(sheet(page).getByRole("tab", { name: "Route & dates" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");

  const dialog = await openPreferences(page);
  await expect(dialog.getByRole("tab", { name: "Packing preferences" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Pre-filled from the saved trip, not defaults: San Diego has Nice outfits on, with one occasion.
  await expect(dialog.getByRole("switch", { name: "Nice outfits" })).toBeChecked();
  await expect(dialog.getByLabel("Occasions")).toHaveValue("1");
  await expect(
    dialog.getByRole("switch", { name: "Dedicated return travel outfit" }),
  ).toBeChecked();
});

test("a recalculation keeps the person's list work: manual, edited, packed and removed items, stored", async ({
  page,
}) => {
  await openSanDiego(page);
  // The person's work: a manual item, an edited suggestion, packed progress, and a removed optional suggestion.
  await page.getByRole("button", { name: "＋ Add item" }).click();
  await page.getByRole("textbox", { name: "Item name" }).fill("Camera");
  await page.getByRole("combobox", { name: "Category" }).selectOption("Tech");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(row(page, "tops")).toBeVisible();
  await row(page, "sleepwear").locator(".item-body").click();
  const editor = page.getByRole("dialog", { name: "Edit item" });
  await editor.getByLabel("Item name").fill("Pajamas");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sleepwear")).toContainText("Pajamas");
  const underwearBefore = (await row(page, "underwear").innerText()).match(
    /(\d+) of (\d+) packed/,
  )!;
  await row(page, "underwear").getByRole("button", { name: "Increase packed Underwear" }).click();
  const underwearNow = `${Number(underwearBefore[1]) + 1} of ${underwearBefore[2]} packed`;
  await expect(row(page, "underwear")).toContainText(underwearNow);
  await row(page, "nice-shoes").locator(".item-body").click();
  await page.getByRole("button", { name: "Remove item" }).click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: /Remove/ })
    .last()
    .click();
  await expect(row(page, "nice-shoes")).toHaveCount(0);

  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry access" }).check();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  // The review names what changes, and what stays.
  await expect(dialog.getByRole("heading", { name: "Review changes to your list" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Updated suggestions" })).toContainText(
    "Everyday tops",
  );
  await dialog.getByText(/Stay as you left them/).click();
  await expect(dialog.getByText(/Camera/)).toBeVisible();
  await expect(dialog.getByText(/Not re-added: Dress shoes/)).toBeVisible();
  // Nothing is applied until Apply: the list behind the sheet is unchanged.
  await expect(row(page, "tops")).toContainText("of 3 packed");
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Preferences updated.");

  // After a reload, from the database: the untouched suggestion followed the new preference; the person's work is intact.
  await page.reload();
  await expect(row(page, "tops")).toContainText("of 2 packed");
  await expect(row(page, "sleepwear")).toContainText("Pajamas");
  await expect(row(page, "underwear")).toContainText(underwearNow);
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(1);
  await expect(row(page, "nice-shoes")).toHaveCount(0);
});

test("a packed count above the new target is shown, needs an acknowledgement, and is lowered to the target", async ({
  page,
}) => {
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Pack all Everyday tops" }).click();
  await expect(row(page, "tops")).toContainText("3 of 3 packed");
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry access" }).check();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog.getByText(/Packed 3 → 2/)).toBeVisible();
  const apply = dialog.getByRole("button", { name: "Apply changes" });
  await expect(apply).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I understand/ }).check();
  await apply.click();
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page, "tops")).toContainText("2 of 2 packed");
});

test("Cancel, Escape and Back leave the trip unchanged, asking before discarding edits", async ({
  page,
}) => {
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry access" }).check();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Back to preferences" }).click();
  await expect(dialog.getByRole("switch", { name: "Laundry access" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Discard your changes?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page, "tops")).toContainText("of 3 packed");
  const again = await openPreferences(page);
  await expect(again.getByRole("switch", { name: "Laundry access" })).not.toBeChecked();
});

test("a review the trip has moved on from is refused: you are asked to review again, selections kept", async ({
  page,
  context,
}) => {
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry access" }).check();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  // Another tab (the same signed-in person) packs something while this review is open.
  const other = await context.newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto(page.url());
  const socks = other.locator('[data-item-id="socks"]');
  const socksBefore = (await socks.innerText()).match(/(\d+) of (\d+) packed/)!;
  const socksNow = `${Number(socksBefore[1]) + 1} of ${socksBefore[2]} packed`;
  // A stepper tap is sent after a short pause: wait for the write that carries it, then a reload shows it stored.
  const written = other.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes("socks"),
  );
  await socks.getByRole("button", { name: "Increase packed Socks" }).click();
  await expect(socks).toContainText(socksNow);
  await written;
  await other.reload();
  await expect(other.locator('[data-item-id="socks"]')).toContainText(socksNow);
  await other.close();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(
    dialog.getByText("Your list changed while you were reviewing. Review again."),
  ).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Laundry access" })).toBeChecked();
  // Reviewing again works on the current list.
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test("Ready turns off with a preference change, and the review says so first", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry access" }).uncheck();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog.getByText("Ready turns off.")).toBeVisible();
  await reviewAndApplyFromReview(page, dialog);
  await expect(page.locator(".toast-region")).toContainText("Ready turned off.");
});

async function reviewAndApplyFromReview(page: Page, dialog: ReturnType<typeof sheet>) {
  const acknowledge = dialog.getByRole("checkbox", { name: /I understand/ });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test(
  "the sheet is accessible and fits a phone: axe on the tab and the review, 44px targets, no sideways scroll",
  DEVICE,
  async ({ page }) => {
    await openSanDiego(page);
    const dialog = await openPreferences(page);
    await expectAccessible(page, "edit trip, preferences tab", { include: '[role="dialog"]' });
    await dialog.getByRole("switch", { name: "Nice outfits" }).uncheck();
    await expect(dialog.getByText("Turn on Nice outfits to set occasions.")).toBeVisible();
    await expectAccessible(page, "edit trip, Nice off with its hint", {
      include: '[role="dialog"]',
    });
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(
      dialog.getByRole("heading", { name: "Review changes to your list" }),
    ).toBeVisible();
    await expectAccessible(page, "edit trip, review", { include: '[role="dialog"]' });
    for (const control of [
      dialog.getByRole("button", { name: "Apply changes" }),
      dialog.getByRole("button", { name: "Back to preferences" }),
      dialog.getByRole("button", { name: "Cancel" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
      // The footer is reachable without scrolling the sheet.
      await expect(control).toBeInViewport();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  },
);
