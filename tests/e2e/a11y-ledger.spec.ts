import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { seedSavedList } from "./helpers/database";
import { expectAccessible, expectDialogKeyboard } from "./helpers/a11y";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE } from "./helpers/device";

// The screens and dialogs added after the first accessibility pass (#21 audit, 2026-10-22): the Staples | Saved lists tabs, the
// lists page and editor, Save as a list, Start from a saved list, the inline Add item, the ⋯ menu and the stamp sheet. Axe on
// each state at both viewports (this spec is tagged for the phone project too), and for every new dialog the keyboard
// behaviour: Tab and Shift+Tab stay inside it, Escape closes it, focus returns to what opened it.
const NOW = new Date("2026-10-16T12:00:00");
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

async function seedLists() {
  await seedSavedList(ownerId(), "Beach week", [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "shorts", name: "Shorts", category: "Clothing", qty: 3 },
    { id: "brush", name: "Toothbrush", category: "Bathroom", qty: 1 },
  ]);
  await seedSavedList(ownerId(), "Ski trip", [
    { id: "gloves", name: "Gloves", category: "Clothing", qty: 1 },
  ]);
}

async function openLists(page: Page) {
  await openDashboard(page);
  await seedLists();
  await page.goto("/staples/lists");
  await expect(page.getByRole("heading", { name: "Lists you reuse", level: 1 })).toBeVisible();
}

async function openPacking(page: Page) {
  await openDashboard(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

test.describe("saved lists", DEVICE, () => {
  test("the Staples tab with the Saved lists switcher, the lists page, and the empty state", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.goto("/staples");
    await expect(page.getByRole("navigation", { name: "Staples sections" })).toBeVisible();
    await expectAccessible(page, "staples with the tabs");
    await page.goto("/staples/lists");
    await expect(page.getByText("No saved lists yet.")).toBeVisible();
    await expectAccessible(page, "saved lists, empty");
    await seedLists();
    await page.reload();
    await expect(page.getByRole("article", { name: "Beach week" })).toBeVisible();
    await expectAccessible(page, "saved lists");
  });

  test("rename and delete sheets: axe", async ({ page }) => {
    await openLists(page);
    const rename = page.getByRole("button", { name: "Rename Beach week" });
    await rename.click();
    await expectAccessible(page, "rename list sheet");
    await page.keyboard.press("Escape");
    const remove = page.getByRole("button", { name: "Delete Beach week" });
    await remove.click();
    await expectAccessible(page, "delete list confirm");
  });

  test("the list editor, its add and edit sheets, and the Undo toast", async ({ page }) => {
    await openLists(page);
    await page.getByRole("link", { name: "Edit Beach week" }).click();
    await expect(page.getByRole("heading", { name: "Beach week", level: 1 })).toBeVisible();
    await expectAccessible(page, "list editor");
    const add = page.getByRole("button", { name: "＋ Add item" });
    await add.click();
    await expectAccessible(page, "add a list item sheet");
    await page.keyboard.press("Escape");
    const edit = page.getByRole("button", { name: "Edit Shorts" });
    await edit.click();
    await expectAccessible(page, "edit a list item sheet");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remove Toothbrush" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expectAccessible(page, "list editor with the Undo toast");
  });

  test("a list that is not there", async ({ page }) => {
    await openLists(page);
    await page.goto("/staples/lists/00000000-0000-4000-8000-0000000000ff");
    await expect(page.getByText("That list isn’t available.")).toBeVisible();
    await expectAccessible(page, "list not available");
  });
});

test.describe("save as a list", DEVICE, () => {
  test("the sheet and the duplicate prompt: axe", async ({ page }) => {
    await openPacking(page);
    const opener = page.getByRole("button", { name: "Save as a list" });
    await opener.click();
    await expectAccessible(page, "save as a list sheet");
    await page.keyboard.press("Escape");

    // Two rows with the same name and category lead to the duplicate prompt.
    await page
      .locator('[data-item-id="sunglasses"]')
      .getByRole("button", { name: /^Sunglasses / })
      .click();
    const editor = page.getByRole("dialog", { name: "Edit item" });
    await editor.getByLabel("Item name").fill("Everyday glasses");
    await editor
      .getByRole("button", { name: /Update this trip|Save/ })
      .first()
      .click();
    await expect(
      page.locator('[data-item-id="sunglasses"]').getByText("Everyday glasses"),
    ).toBeVisible();
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Save as a list" });
    await sheet.getByRole("button", { name: "Save list" }).click();
    await expect(page.getByRole("dialog", { name: "Some items appear twice" })).toBeVisible();
    await expectAccessible(page, "save as a list, duplicate prompt");
  });
});

test.describe("start from a saved list", DEVICE, () => {
  test("the step with a list previewed", async ({ page }) => {
    await openDashboard(page);
    await seedLists();
    await page.getByRole("link", { name: /Plan a trip/ }).click();
    await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
    await page
      .getByRole("option", { name: /Portugal/ })
      .first()
      .click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Start from a saved list", level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, "start from a saved list");
    await page.getByRole("button", { name: "Preview items in Beach week" }).click();
    await page.getByRole("radio", { name: /Beach week/ }).check();
    await expect(page.getByRole("status", { name: "Saved list choice" })).toBeVisible();
    await expectAccessible(page, "start from a saved list, one chosen and previewed");
  });
});

test.describe("add item, the ⋯ menu and the stamp sheet", DEVICE, () => {
  test("the dashboard's inline Add item and a trip's ⋯ menu", async ({ page }) => {
    await openDashboard(page);
    await page
      .getByRole("article", { name: "San Diego" })
      .getByRole("button", { name: "＋ Add item" })
      .click();
    await expect(page.getByRole("textbox", { name: "Item name" })).toBeVisible();
    await expectAccessible(page, "dashboard hero with the inline Add item open");
    await page
      .getByRole("article", { name: "San Diego" })
      .getByRole("button", { name: "＋ Add item" })
      .click();
    await page.getByRole("button", { name: "More actions for San Diego" }).click();
    await expect(page.getByRole("menuitem", { name: "Quick view" })).toBeVisible();
    await expectAccessible(page, "dashboard with the trip menu open");
    await page.keyboard.press("Escape");
    await chooseFromMenu(page, "San Diego", "Quick view");
    await expect(page.getByText("Packing quick view")).toBeVisible();
  });

  test("the packing screen's inline Add item", async ({ page }) => {
    await openPacking(page);
    await page.getByRole("button", { name: "＋ Add item" }).click();
    await expect(page.getByRole("textbox", { name: "Item name" })).toBeVisible();
    await expectAccessible(page, "packing screen with the inline Add item open");
  });
});

// The keyboard behaviour of each new dialog. Tab order is Chromium's: Safari only tabs to buttons and links when the person
// turns on full keyboard access, so this runs on the desktop project, as the first audit's trap test does.
test.describe("keyboard in the new dialogs", () => {
  test("Rename, Delete, and the list item sheets (Add and Edit)", async ({ page }) => {
    await openLists(page);
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "Rename Beach week" }),
      page.getByRole("dialog", { name: "Rename list" }),
    );
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "Delete Beach week" }),
      page.getByRole("dialog", { name: "Delete “Beach week”?" }),
    );
    await page.getByRole("link", { name: "Edit Beach week" }).click();
    await expect(page.getByRole("heading", { name: "Beach week", level: 1 })).toBeVisible();
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "＋ Add item" }),
      page.getByRole("dialog", { name: "Add an item" }),
    );
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "Edit Shorts" }),
      page.getByRole("dialog", { name: "Edit item" }),
    );
  });

  test("Save as a list, and the Stamp label sheet", async ({ page }) => {
    await openPacking(page);
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "Save as a list" }),
      page.getByRole("dialog", { name: "Save as a list" }),
    );
    await expectDialogKeyboard(
      page,
      page.getByRole("button", { name: "Edit stamp" }),
      page.getByRole("dialog", { name: "Stamp label" }),
    );
  });
});

// Every new notice that is not in a dialog goes through the polite status region (role="status"), where a screen reader reads it
// once; the toast's own timing and pause behaviour are unit-tested (Toast.test.tsx).
test("the new toasts are announced in the polite status region", async ({ page }) => {
  await openLists(page);
  const region = page.locator(".toast-region");
  await expect(region).toHaveAttribute("role", "status");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await page.getByRole("button", { name: "Rename Beach week" }).click();
  const sheet = page.getByRole("dialog", { name: "Rename list" });
  await sheet.getByLabel("List name").fill("Lake week");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(region.getByText("Renamed to “Lake week”.")).toBeVisible();

  await page.getByRole("link", { name: "Edit Lake week" }).click();
  await page.getByRole("button", { name: "Remove Toothbrush" }).click();
  await expect(region.getByRole("button", { name: "Undo" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit stamp" }).click();
  const stamp = page.getByRole("dialog", { name: "Stamp label" });
  await stamp.getByRole("radio", { name: "Custom" }).check();
  await stamp.getByRole("textbox", { name: "Label", exact: true }).fill("sd7");
  await stamp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(region.getByText("Stamp updated.")).toBeVisible();
});

test.describe("narrow screens", DEVICE, () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("nothing scrolls sideways at 320px on the lists page, the editor, and the packing screen with its new sheets", async ({
    page,
  }) => {
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    await openLists(page);
    expect(await overflow(), "lists page").toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "Edit Beach week" }).click();
    await expect(page.getByRole("heading", { name: "Beach week", level: 1 })).toBeVisible();
    expect(await overflow(), "list editor").toBeLessThanOrEqual(0);
    await page.goto("/");
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
    expect(await overflow(), "packing screen").toBeLessThanOrEqual(0);
    for (const [opener, dialog] of [
      ["Save as a list", "Save as a list"],
      ["Edit stamp", "Stamp label"],
    ]) {
      await page.getByRole("button", { name: opener }).click();
      await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
      expect(await overflow(), dialog).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  });
});
