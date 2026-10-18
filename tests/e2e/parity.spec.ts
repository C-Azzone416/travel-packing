import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Parity with the approved prototype's browser test (reference/prototype/tests/browser.test.mjs), on the production app
// and its real database. Most scenarios are covered by the feature specs; docs/parity.md maps EVERY prototype scenario to
// the test that covers it. The tests here close the gaps that mapping found. Each test starts from the freshly seeded
// owner (see signInAsOwner), at both viewports.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

async function openSanDiego(page: Page) {
  await openDashboard(page);
  await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" });

async function setPreference(page: Page, name: string, on: boolean) {
  await page.getByRole("button", { name: "Edit preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit packing preferences" });
  const toggle = dialog.getByRole("switch", { name });
  if (on) await toggle.check();
  else await toggle.uncheck();
  await dialog.getByRole("button", { name: "Update this trip" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("home: the headline, three navigation items, one upcoming trip with a 'left to pack' badge, and history kept apart", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(
    page.getByRole("heading", { name: "Pack for the trip, not the anxiety.", level: 1 }),
  ).toBeVisible();
  await expect(nav(page).getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.locator(".status-pill.remaining")).toHaveCount(1);
  await expect(page.locator(".status-pill.remaining")).toContainText(/left to pack/);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Past trip").first()).toBeVisible();
  await expect(page.locator(".status-pill.ready")).toBeVisible();
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
});

test("dates: a later departure pulls the return forward and becomes its minimum", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
  await page.getByLabel("Leave", { exact: true }).fill("2026-12-20");
  await expect(page.getByLabel("Return", { exact: true })).toHaveValue("2026-12-20");
  await expect(page.getByLabel("Return", { exact: true })).toHaveAttribute("min", "2026-12-20");
});

test("staples: four sections in order, the Bathroom note, Pack last as a badge only, and the seven flagged defaults", async ({
  page,
}) => {
  await openDashboard(page);
  await page.goto("/staples");
  await expect(
    page.getByRole("heading", { name: "Every trip starts here", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("My staples", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Clothing",
    "Bathroom",
    "Tech",
    "Other essentials",
  ]);
  await expect(page.getByText(/normal Toiletries checkboxes/)).toBeVisible();
  await expect(page.getByText("Pack last defaults")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  const glasses = page.locator("[data-staple-id]").filter({ hasText: "Everyday glasses" });
  const sunglasses = page.locator("[data-staple-id]").filter({ hasText: "Sunglasses" });
  await expect(glasses).toHaveCount(1);
  await expect(glasses).toContainText("Pack last");
  await expect(sunglasses).toHaveCount(1);
  await expect(sunglasses).not.toContainText("Pack last");
  const edits = page.getByRole("button", { name: /^Edit / });
  await expect(edits).toHaveCount(await page.locator("[data-staple-id]").count());

  await page.getByRole("button", { name: "Pack last" }).click();
  const rows = page.locator("[data-staple-id]");
  await expect(rows).toHaveCount(7);
  for (const tag of await rows.locator(".timing-tag").all())
    await expect(tag).toHaveText("Pack last");
  await expect(rows.locator(".timing-tag")).toHaveCount(7);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Bathroom",
    "Tech",
    "Other essentials",
  ]);
});

test("Nice outfits: switching off hides the Nice items, switching back on restores their edits and progress, with one of each", async ({
  page,
}) => {
  await openSanDiego(page);
  await expect(row(page, "nice-shoes")).toHaveCount(1);
  await expect(row(page, "nice-makeup")).toHaveCount(1);
  await expect(row(page, "nice-undergarments")).toHaveCount(1);

  await row(page, "nice-shoes").locator(".item-body").click();
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await row(page, "nice-shoes")
    .getByRole("button", { name: "Increase packed Dress shoes" })
    .click();
  await expect(row(page, "nice-shoes")).toContainText("1/2");

  for (let round = 0; round < 2; round += 1) {
    await setPreference(page, "Nice outfits", false);
    await expect(row(page, "nice-shoes")).toHaveCount(0);
    await expect(row(page, "nice-makeup")).toHaveCount(0);
    await expect(row(page, "nice-undergarments")).toHaveCount(0);
    await setPreference(page, "Nice outfits", true);
    await expect(row(page, "nice-shoes")).toHaveCount(1);
    await expect(row(page, "nice-shoes")).toContainText("1/2");
    await expect(row(page, "nice-makeup")).toHaveCount(1);
    await expect(row(page, "nice-undergarments")).toHaveCount(1);
  }
});

test("a removed optional item stays removed through later recalculations", async ({ page }) => {
  await openSanDiego(page);
  await row(page, "nice-undergarments").locator(".item-body").click();
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove item" }).click();
  await expect(row(page, "nice-undergarments")).toHaveCount(0);
  await setPreference(page, "Laundry access", true);
  await expect(row(page, "nice-undergarments")).toHaveCount(0);
  await setPreference(page, "Nice outfits", false);
  await setPreference(page, "Nice outfits", true);
  await expect(row(page, "nice-undergarments")).toHaveCount(0);
  await page.reload();
  await expect(row(page, "nice-undergarments")).toHaveCount(0);
});

test("copy: a remembered Bathroom item travels to the copy, with nothing checked, one Makeup, and the source unchanged", async ({
  page,
}) => {
  await openSanDiego(page);
  // Remember a new Bathroom staple from this trip.
  await page.getByRole("button", { name: "＋ Add a Bathroom item" }).click();
  const add = page.getByRole("dialog", { name: "Add a Bathroom item" });
  await add.getByLabel("Item name").fill("Face wash");
  await add.getByRole("radio", { name: /Remember for future trips/ }).check();
  await add.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to trips" }).click();
  const source = page.getByRole("article", { name: "San Diego" });
  const before = await source.innerText();

  await source.getByRole("link", { name: "Copy trip: San Diego" }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: /Paris/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-12-04");
  await page.getByLabel("Return", { exact: true }).fill("2026-12-08");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("article", { name: "Paris" })).toBeVisible();
  expect(await page.getByRole("article", { name: "San Diego" }).innerText()).toBe(before);

  await page.getByRole("link", { name: "Keep packing: Paris" }).click();
  await expect(page.getByRole("heading", { name: "Paris", level: 1 })).toBeVisible();
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await expect(row(page, "nice-makeup")).toHaveCount(1);
  await expect(row(page, "nice-shoes")).toHaveCount(1);
  await expect(page.locator(".pack-row.complete")).toHaveCount(0);
  await expect(page.getByText("Toiletry bag is in the suitcase")).toHaveCount(0);
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
});

test("a tour of every screen raises no uncaught browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSanDiego(page);
  const id = new URL(page.url()).pathname.split("/").pop();
  for (const path of ["/", "/staples", "/settings", `/trips/${id}`, `/trips/${id}/review`, "/"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(errors).toEqual([]);
});
