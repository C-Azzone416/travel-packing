import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// The Staples screen against a REAL Postgres (#18): what it shows after a reload is what was stored. Each test starts
// from this project's freshly seeded owner (the default staples, San Diego partly packed, Lisbon Ready).
const NOW = new Date("2026-10-16T12:00:00");

const staple = (page: Page, id: string) => page.locator(`[data-staple-id="${id}"]`);
const section = (page: Page, name: string) => page.getByRole("region", { name });

async function openStaples(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.goto("/staples");
  await expect(
    page.getByRole("heading", { name: "Every trip starts here", level: 1 }),
  ).toBeVisible();
  await expect(section(page, "Clothing")).toBeVisible();
}

async function newTrip(
  page: Page,
  destination: RegExp,
  start: string,
  end: string,
  expectedCount: number,
) {
  await page.goto("/");
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: destination }).click();
  await page.getByLabel("Leave", { exact: true }).fill(start);
  await page.getByLabel("Return", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Paris", level: 2 })).toHaveCount(expectedCount);
}

async function underwearQty(page: Page, tripName: string): Promise<number> {
  await page.getByRole("link", { name: new RegExp(`Keep packing: ${tripName}`) }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  const text = await page
    .locator('[data-item-id="underwear"] .qty-stepper span')
    .first()
    .innerText();
  await page.goBack();
  return Number(text.split("/")[1]);
}

test("edit a staple: existing trips are unchanged, and the next new trip uses the new value", async ({
  page,
}) => {
  await openStaples(page);
  await page.goto("/");
  await newTrip(page, /Paris/, "2026-12-04", "2026-12-08", 1);
  const sanDiegoBefore = await underwearQty(page, "San Diego");
  const parisBefore = await underwearQty(page, "Paris");

  await page.goto("/staples");
  await expect(section(page, "Clothing")).toBeVisible();
  await staple(page, "underwear").getByRole("button", { name: "Edit Underwear" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit staple" });
  await dialog.getByLabel("Quantity").fill("2");
  await dialog.getByRole("button", { name: "Save staple" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(staple(page, "underwear")).toContainText("2 per day");
  await page.reload();
  await expect(staple(page, "underwear")).toContainText("2 per day");

  // Existing trips keep their lists.
  await page.goto("/");
  expect(await underwearQty(page, "San Diego")).toBe(sanDiegoBefore);
  expect(await underwearQty(page, "Paris")).toBe(parisBefore);

  // A trip made after the edit uses it.
  await newTrip(page, /Paris/, "2026-12-04", "2026-12-08", 2);
  await page.goto("/");
  const second = page.getByRole("link", { name: /Keep packing: Paris/ }).first();
  await second.click();
  await expect(page.getByRole("heading", { name: "Paris", level: 1 })).toBeVisible();
  const text = await page
    .locator('[data-item-id="underwear"] .qty-stepper span')
    .first()
    .innerText();
  expect(Number(text.split("/")[1])).toBeGreaterThan(parisBefore);
});

test("add a staple: it is stored, and Pack last starts off", async ({ page }) => {
  await openStaples(page);
  await page.getByRole("button", { name: /Add/ }).click();
  const dialog = page.getByRole("dialog", { name: "Add a staple" });
  await expect(dialog.getByRole("switch", { name: "Pack last" })).not.toBeChecked();
  await dialog.getByLabel("Item name").fill("Phone charger");
  await dialog.getByLabel("Category").selectOption("Tech");
  await dialog.getByRole("button", { name: "Add staple" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(section(page, "Tech").getByText("Phone charger")).toBeVisible();
  await page.reload();
  await expect(section(page, "Tech").getByText("Phone charger")).toBeVisible();
  await expect(section(page, "Tech").getByText("Phone charger")).not.toContainText("Pack last");
});

test("a duplicate name is refused with a way to edit the existing staple", async ({ page }) => {
  await openStaples(page);
  await page.getByRole("button", { name: /Add/ }).click();
  const dialog = page.getByRole("dialog", { name: "Add a staple" });
  await dialog.getByLabel("Item name").fill("socks");
  await expect(dialog.getByText("You already have Socks.")).toBeVisible();
  await dialog.getByRole("button", { name: "Edit it instead" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit staple" }).getByLabel("Item name"),
  ).toHaveValue("Socks");
});

test("the Pack last filter narrows the list and announces the count", async ({ page }) => {
  await openStaples(page);
  await page.getByRole("button", { name: "Pack last" }).click();
  await expect(page.getByRole("button", { name: "Pack last" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section(page, "Clothing")).toHaveCount(0);
  await expect(section(page, "Bathroom")).toBeVisible();
  await expect(page.getByRole("status", { name: "Staples updates" })).toHaveText("7 staples shown");
  await page.getByRole("button", { name: "All" }).click();
  await expect(section(page, "Clothing")).toBeVisible();
});

test("one owner's staples are not another's", async ({ page, browser }) => {
  await openStaples(page);
  await page.getByRole("button", { name: /Add/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Item name").fill("Only mine");
  await dialog.getByRole("button", { name: "Add staple" }).click();
  await expect(page.locator("[data-staple-id]").getByText("Only mine")).toBeVisible();

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    const { SECOND_EMAIL, signIn } = await import("./helpers/auth");
    await signIn(second, SECOND_EMAIL);
    await expect(second).toHaveURL(/\/$/);
    await second.goto("/staples");
    await expect(
      second.getByRole("heading", { name: "Every trip starts here", level: 1 }),
    ).toBeVisible();
    await expect(second.getByRole("region", { name: "Clothing" })).toBeVisible();
    await expect(second.getByText("Only mine")).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("controls are 44px targets on phone and nothing scrolls sideways", async ({
  page,
}, testInfo) => {
  await openStaples(page);
  if (testInfo.project.name === "phone") {
    for (const control of [
      page.getByRole("button", { name: "All" }),
      page.getByRole("button", { name: "Pack last" }),
      staple(page, "underwear").getByRole("button", { name: "Edit Underwear" }),
      page.getByRole("button", { name: /Add/ }),
    ]) {
      await expect(control).toBeVisible();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("screenshots of the staples screen", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string, fullPage = true) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-staples-${name}.png`,
      fullPage,
    });
  await openStaples(page);
  await shot("all");
  await page.getByRole("button", { name: "Pack last" }).click();
  await shot("pack-last");
  await page.getByRole("button", { name: "All" }).click();
  await staple(page, "last-toothbrush").getByRole("button", { name: "Edit Toothbrush" }).click();
  await shot("editor-bathroom", false);
  await page.getByRole("dialog").getByRole("button", { name: /close/i }).click();
  await page.getByRole("button", { name: /Add/ }).click();
  await page.getByRole("dialog").getByLabel("Item name").fill("socks");
  await shot("duplicate", false);
});
