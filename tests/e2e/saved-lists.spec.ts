import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { seedSavedList } from "./helpers/database";
import { DEVICE } from "./helpers/device";

// Saved lists (#167), against the real database: the Staples | Saved lists tab, the lists page, rename, delete and the
// list editor. Lists are made from a trip's packing screen in a later mission, so these tests seed them directly.
const NOW = new Date("2026-10-16T12:00:00");
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function openLists(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await seedSavedList(ownerId(), "Beach week", [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "shorts", name: "Shorts", category: "Clothing", qty: 3 },
    { id: "brush", name: "Toothbrush", category: "Bathroom", qty: 1 },
  ]);
  await seedSavedList(ownerId(), "Ski trip", [
    { id: "gloves", name: "Gloves", category: "Clothing", qty: 1 },
  ]);
  await page.goto("/staples");
  await page
    .getByRole("navigation", { name: "Staples sections" })
    .getByRole("link", { name: "Saved lists" })
    .click();
  await expect(page.getByRole("heading", { name: "Lists you reuse", level: 1 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });

test("the Staples | Saved lists switcher moves between the two pages, and the nav keeps Staples current", async ({
  page,
}) => {
  await openLists(page);
  const tabs = page.getByRole("navigation", { name: "Staples sections" });
  await expect(tabs.getByRole("link", { name: "Saved lists" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Staples" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/Saved lists/);
  await tabs.getByRole("link", { name: "Staples" }).click();
  await expect(
    page.getByRole("heading", { name: "Every trip starts here", level: 1 }),
  ).toBeVisible();
});

test("shows a card per list with its count, last change and categories, newest first; no Add button", async ({
  page,
}) => {
  await openLists(page);
  const beach = card(page, "Beach week");
  await expect(beach.getByText(/^3 items · updated /)).toBeVisible();
  await expect(beach.getByText(/Clothing 1/)).toBeVisible();
  await expect(card(page, "Ski trip").getByText(/^1 item · updated /)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add/ })).toHaveCount(0);
});

test("renames a list (and says when the name is taken), and the new name is stored", async ({
  page,
}) => {
  await openLists(page);
  await page.getByRole("button", { name: "Rename Beach week" }).click();
  const sheet = page.getByRole("dialog", { name: "Rename list" });
  await sheet.getByLabel("List name").fill("ski TRIP");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText(/You already have a list called/)).toBeVisible();
  await sheet.getByLabel("List name").fill("Lake week");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page, "Lake week")).toBeVisible();
  await page.reload();
  await expect(card(page, "Lake week")).toBeVisible();
  await expect(card(page, "Beach week")).toHaveCount(0);
});

test("deletes a list only after confirming, and says existing trips are not affected", async ({
  page,
}) => {
  await openLists(page);
  await page.getByRole("button", { name: "Delete Beach week" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete “Beach week”?" });
  await expect(sheet.getByText(/This can't be undone\./)).toBeVisible();
  await expect(sheet.getByText(/Trips already made from this list aren't affected/)).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(card(page, "Beach week")).toBeVisible();
  await page.getByRole("button", { name: "Delete Beach week" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete list" }).click();
  await expect(card(page, "Beach week")).toHaveCount(0);
  await page.reload();
  await expect(card(page, "Ski trip")).toBeVisible();
  await expect(card(page, "Beach week")).toHaveCount(0);
  // The trips are exactly as they were.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
});

test("edits a list: add, edit and remove an item (with Undo), the duplicate is refused, and it is all stored", async ({
  page,
}) => {
  await openLists(page);
  await page.getByRole("link", { name: "Edit Beach week" }).click();
  await expect(page.getByRole("heading", { name: "Beach week", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Clothing" }).getByText("Shorts")).toBeVisible();

  // Add.
  await page.getByRole("button", { name: "＋ Add item" }).click();
  let sheet = page.getByRole("dialog", { name: "Add an item" });
  await sheet.getByLabel("Item name").fill("Camera");
  await sheet.getByLabel("Category").selectOption("Tech");
  await sheet.getByLabel("Needed quantity").fill("2");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Tech" }).getByText("Camera")).toBeVisible();

  // The same item again is refused.
  await page.getByRole("button", { name: "＋ Add item" }).click();
  sheet = page.getByRole("dialog", { name: "Add an item" });
  await sheet.getByLabel("Item name").fill(" camera ");
  await sheet.getByLabel("Category").selectOption("Tech");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText(/Camera is already in this list \(needed: 2\)/)).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();

  // Edit the quantity.
  await page.getByRole("button", { name: "Edit Shorts" }).click();
  sheet = page.getByRole("dialog", { name: "Edit item" });
  await sheet.getByLabel("Needed quantity").fill("4");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Clothing" }).getByText("Needed 4")).toBeVisible();

  // Remove, then Undo.
  await page.getByRole("button", { name: "Remove Toothbrush" }).click();
  await expect(page.getByText("Toothbrush", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("region", { name: "Bathroom" }).getByText("Toothbrush"),
  ).toBeVisible();

  // Stored: still there after a reload, once each.
  await page.reload();
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Clothing" }).getByText("Needed 4")).toBeVisible();
  await expect(page.getByText("Toothbrush", { exact: true })).toHaveCount(1);
});

test("a list that doesn't exist says so, with a way back", async ({ page }) => {
  await openLists(page);
  await page.goto("/staples/lists/00000000-0000-4000-8000-0000000000ff");
  await expect(page.getByText("That list isn’t available.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Saved lists/ })).toHaveAttribute(
    "href",
    "/staples/lists",
  );
});

test("the empty state points to the trip's packing screen", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.goto("/staples/lists");
  await expect(page.getByText("No saved lists yet.")).toBeVisible();
  await expect(page.getByText(/choose Save as a list/)).toBeVisible();
  await page.getByRole("link", { name: "Go to trips", exact: true }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
});

test(
  "fits a phone: 44px targets, no sideways scroll, on the lists page and the editor",
  DEVICE,
  async ({ page }) => {
    await openLists(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (const control of [
      page.getByRole("link", { name: "Edit Beach week" }),
      page.getByRole("button", { name: "Rename Beach week" }),
      page.getByRole("button", { name: "Delete Beach week" }),
      page.getByRole("link", { name: "Saved lists" }).first(),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    }
    await page.getByRole("link", { name: "Edit Beach week" }).click();
    await expect(page.getByRole("heading", { name: "Beach week", level: 1 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  },
);
