import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { seedSavedList } from "./helpers/database";
import { DEVICE, laptopPlanLayout, phoneHomeLayout } from "./helpers/device";
import { allItemIds, cubeNav, expectItem, expectPacking, showByName } from "./helpers/packing";
import { chooseFromMenu, planATrip, futureRow } from "./helpers/menu";
import { planToList, reviewAndCreate } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

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

const LISBON = {
  query: "lisbon",
  option: /Portugal/,
  start: "2026-11-12",
  end: "2026-11-16",
};

/** Plan a trip to Lisbon, up to the Starting list. */
async function startStep(page: Page) {
  await planATrip(page);
  await planToList(page, LISBON);
}

const savedListCard = (page: Page) =>
  page.getByRole("checkbox", { name: /Start from a saved list/ });

test("with saved lists: choose one, see the count, and the new trip is exactly the list, unpacked", async ({
  page,
}) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);

  await expect(savedListCard(page)).not.toBeChecked();
  await savedListCard(page).check();
  await page.getByRole("radio", { name: /Beach week/ }).check();
  await expect(page.getByRole("radio", { name: /Beach week · 3 items/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Ski trip · 1 item/ })).not.toBeChecked();
  // The list replaces the Staples: the Staples card says so, and the preview counts the list .
  await expect(page.getByRole("checkbox", { name: /Your Staples/ })).toHaveAccessibleDescription(
    "Your saved list stands in for them on this trip",
  );
  // No weather and no past-trip copy is mixed into a list trip.
  await expect(page.getByRole("checkbox", { name: /Copy a past trip/ })).toHaveCount(0);

  await reviewAndCreate(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();

  await (await futureRow(page, /Lisbon/)).click();
  await expectPacking(page);
  const ids = await allItemIds(page);
  expect(ids).toHaveLength(3);
  // Staples and the length-based items are gone, and the Bathroom row lives in the Toiletries cube.
  expect(ids).not.toContain("socks");
  expect(ids).not.toContain("underwear");
  await expect(cubeNav(page).getByRole("button", { name: /^Toiletries/ })).toBeVisible();
  await expect(await showByName(page, "Toothbrush")).toBeVisible();
  // 6 units: the towel twice, the shorts three times and the toothbrush.
  await expect(page.getByText("0 of 6 in the bag")).toBeVisible();
  const towel = (await showByName(page, "Beach towel")).getByRole("checkbox", {
    name: "Beach towel, 2",
  });
  await expect(towel).not.toBeChecked();
  await expect(await showByName(page, "Shorts")).toBeVisible();
});

test("the preview counts the list: its items by quantity", async ({ page }) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);
  await laptopPlanLayout(page); // the live preview panel is the laptop Plan layout
  await savedListCard(page).check();
  await page.getByRole("radio", { name: /Beach week/ }).check();
  // 2 towels + 3 shorts + 1 toothbrush,.
  await expect(
    page
      .getByRole("complementary", { name: "Live preview of your trip" })
      .getByText("About 6 items to start"),
  ).toBeVisible();
});

test("with saved lists but none chosen: the Staples and recommendations", async ({ page }) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);
  await expect(page.getByRole("checkbox", { name: /Your Staples/ })).toBeChecked();
  await reviewAndCreate(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await (await futureRow(page, /Lisbon/)).click();
  await expectPacking(page);
  await expectItem(page, "socks");
  await expect(page.getByText("Beach towel")).toHaveCount(0);
});

test("changing your mind: a different list, or the Staples again, is what sticks", async ({
  page,
}) => {
  await openDashboard(page);
  await seedBeach();
  await startStep(page);
  await savedListCard(page).check();
  await page.getByRole("radio", { name: /Beach week/ }).check();
  await page.getByRole("radio", { name: /Ski trip/ }).check();
  await expect(page.getByRole("radio", { name: /Beach week/ })).not.toBeChecked();
  await reviewAndCreate(page);
  await (await futureRow(page, /Lisbon/)).click();
  await expectPacking(page);
  expect(await allItemIds(page)).toHaveLength(1);
  await expect(await showByName(page, "Gloves")).toBeVisible();
});

test("without any saved list there is no saved-list card at all", async ({ page }) => {
  await openDashboard(page);
  await startStep(page);
  await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
  await expect(savedListCard(page)).toHaveCount(0);
});

test("copying a trip never offers a saved list, even when lists exist", async ({ page }) => {
  await openDashboard(page);
  await seedBeach();
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await planToList(page, LISBON);
  await expect(page.getByRole("checkbox", { name: /Copy a past trip/ })).toBeChecked();
  await expect(savedListCard(page)).toHaveCount(0);
});

test(
  "on a phone the starting list fits the screen, with 44px targets",
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
    await savedListCard(page).check();
    for (const control of [
      page.getByRole("button", { name: "Next", exact: true }),
      page.getByRole("button", { name: "Back", exact: true }),
      savedListCard(page).locator("xpath=ancestor::label"),
      page.getByRole("radio", { name: /Beach week/ }).locator("xpath=ancestor::label"),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
    expect(await overflow()).toBe(false);
  },
);
