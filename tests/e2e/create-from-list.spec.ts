import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { seedSavedList } from "./helpers/database";
import { DEVICE } from "./helpers/device";
import { chooseFromMenu } from "./helpers/menu";

// Create flow: Start from a saved list (#170), against the real database. A chosen list REPLACES staples and the
// length-based recommendations; none chosen is today's flow; a copy never offers the step.
const NOW = new Date("2026-10-16T12:00:00");
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

async function seedBeach() {
  await seedSavedList(ownerId(), "Beach week", [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "shorts", name: "Shorts", category: "Clothing", qty: 3 },
    { id: "brush", name: "Toothbrush", category: "Bathroom", qty: 1 },
  ]);
  await seedSavedList(ownerId(), "Ski trip", [
    { id: "gloves", name: "Gloves", category: "Clothing", qty: 1 },
  ]);
}

async function pickLisbon(page: Page) {
  await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
  await page
    .getByRole("option", { name: /Portugal/ })
    .first()
    .click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
}

async function startStep(page: Page) {
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pickLisbon(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Start from a saved list", level: 1 }),
  ).toBeVisible();
}

const rows = (page: Page) => page.locator("[data-item-id]");

test("with saved lists: choose one, review it, and the new trip is exactly the list, unpacked", async ({
  page,
}) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);

  const group = page.getByRole("radiogroup", { name: "Starting point" });
  await expect(group.getByRole("radio", { name: /No saved list/ })).toBeChecked();
  await group.getByRole("button", { name: "Preview items in Beach week" }).click();
  await expect(page.getByRole("region", { name: "Items in Beach week" })).toContainText(
    "Beach towel",
  );
  await group.getByRole("radio", { name: /Beach week/ }).check();
  await expect(group.getByRole("radio", { name: /No saved list/ })).not.toBeChecked();
  await expect(page.getByRole("status", { name: "Saved list choice" })).toContainText(
    "“Beach week” replaces your staples and recommendations.",
  );

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your list", level: 1 })).toBeVisible();
  await expect(page.getByText("Starting from “Beach week”")).toBeVisible();
  await expect(page.getByText("Your packing preferences")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Bathroom" })).toContainText("Toothbrush");
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();

  await page.getByRole("link", { name: "Keep packing: Lisbon" }).click();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: "Beach towel" })).toContainText("0 of 2 packed");
  await expect(rows(page).filter({ hasText: "Shorts" })).toBeVisible();
  // Staples and the length-based items are gone, and Bathroom rows live in the toiletries group.
  await expect(page.getByText("Socks", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Underwear", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Toiletries" })).toBeVisible();
  // 6 units plus the toiletry bag, which counts as one more step.
  await expect(page.getByText("0 of 7 packed / 7 left")).toBeVisible();
});

test("with saved lists but none chosen: today's Shape the list, staples and recommendations", async ({
  page,
}) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shape the list", level: 1 })).toBeVisible();
  await expect(page.getByText("Your packing preferences")).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Keep packing: Lisbon" }).click();
  await expect(page.locator('[data-item-id="socks"]')).toBeVisible();
  await expect(page.getByText("Beach towel")).toHaveCount(0);
});

test("changing your mind: Change starting point from the review goes back and a different choice sticks", async ({
  page,
}) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);
  await page.getByRole("radio", { name: /Beach week/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Change starting point" }).click();
  await expect(page.getByRole("radio", { name: /Beach week/ })).toBeChecked();
  await page.getByRole("radio", { name: /Ski trip/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Starting from “Ski trip”")).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page.getByRole("link", { name: "Keep packing: Lisbon" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Gloves");
});

test("without any saved list there is no list step at all", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pickLisbon(page);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start from a saved list" })).toHaveCount(0);
});

test("copying a trip never offers the list step, even when lists exist", async ({ page }) => {
  await openDashboard(page);
  await seedBeach();
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await expect(page.getByText("Copy of San Diego")).toBeVisible();
  await pickLisbon(page);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start from a saved list" })).toHaveCount(0);
});

test(
  "on a phone the step and the review fit the screen, with 44px targets",
  DEVICE,
  async ({ page }) => {
    await openDashboard(page);
    await seedBeach();
    await startStep(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await overflow()).toBe(false);
    for (const control of [
      page.getByRole("button", { name: "Continue", exact: true }),
      page.getByRole("button", { name: "Back", exact: true }),
      page.getByRole("button", { name: "Preview items in Beach week" }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("radio", { name: /Beach week/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review your list" })).toBeVisible();
    expect(await overflow()).toBe(false);
  },
);
