import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import {
  expectItem,
  expectNoItem,
  expectPacking,
  openCube,
  openEditor,
  showItem,
  tick,
} from "./helpers/packing";
import { reviewAndApply } from "./helpers/preferences";
import { planAndCreate, pickPlace, toWhen } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

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
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" });

async function setPreference(page: Page, name: string, on: boolean) {
  await page.getByRole("button", { name: "Edit preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  const toggle = dialog.getByRole("switch", { name });
  if (on) await toggle.check();
  else await toggle.uncheck();
  await reviewAndApply(page, dialog);
}

test("home: the headline, four navigation items (Stamps joins the laptop menu), one upcoming trip with a 'left to pack' badge, and history kept apart", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "Your travel ledger", level: 1 })).toBeVisible();
  // The laptop menu has the fourth item (Stamps); the tab bar below 1024px has three. Check it at laptop width, then go back.
  const before = page.viewportSize();
  if (test.info().project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(nav(page).getByRole("link")).toHaveCount(4);
    if (before) await page.setViewportSize(before);
  }
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText(/\d+ left/);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Past trip").first()).toBeVisible();
  await expect(page.locator(".status-pill.ready")).toBeVisible();
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
  // Status badges stay compact and as wide as their text (prototype 90-97). The prototype's limit was 105px for its shorter
  // "Ready" text; the pill now reads "✓ Ready to go" (106px), so the limit is for a pill that is not stretched.
  const badges = await page.locator(".status-pill").evaluateAll((nodes) =>
    nodes.map((node) => ({
      height: node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width,
    })),
  );
  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) {
    expect(badge.height).toBeLessThanOrEqual(24);
    expect(badge.width).toBeLessThan(130);
  }
});

test("dates: a later departure pulls the return forward and becomes its minimum", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pickPlace(page, "lon", /England/);
  await toWhen(page);
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
  await page.getByLabel("Leave", { exact: true }).fill("2026-12-20");
  await expect(page.getByLabel("Return", { exact: true })).toHaveValue("2026-12-20");
  await expect(page.getByLabel("Return", { exact: true })).toHaveAttribute("min", "2026-12-20");
});

test("staples: five cubes in order, Pack last as a badge only, and the seven flagged defaults", async ({
  page,
}) => {
  await openDashboard(page);
  await page.goto("/staples");
  await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
  const cubes = page.locator("section[aria-labelledby^='staples-']");
  await expect(cubes.getByRole("heading", { level: 2 })).toHaveText([
    "Clothing",
    "Toiletries",
    "Tech",
    "Documents",
    "Misc",
  ]);
  await expect(page.getByText("Pack last defaults")).toHaveCount(0);
  const glasses = page.locator("[data-staple-id]").filter({ hasText: "Everyday glasses" });
  const sunglasses = page.locator("[data-staple-id]").filter({ hasText: "Sunglasses" });
  await expect(glasses).toHaveCount(1);
  await expect(glasses).toContainText("Pack last");
  await expect(sunglasses).toHaveCount(1);
  await expect(sunglasses).not.toContainText("Pack last");
  // Every staple opens its editor from its row.
  const rowButtons = page.locator("[data-staple-id] > button");
  await expect(rowButtons).toHaveCount(await page.locator("[data-staple-id]").count());
  const flagged = page.locator("[data-staple-id]").filter({ hasText: "Pack last" });
  await expect(flagged).toHaveCount(7);
});

test("packing screen: the return travel outfit, no umbrella before the weather review, and a Bathroom item flagged Pack last only in Toiletries", async ({
  page,
}) => {
  await openSanDiego(page);
  await expectItem(page, "return-top");
  await expect(
    (await showItem(page, "return-top")).getByRole("checkbox", { name: /return outfit$/ }),
  ).toHaveCount(1);
  await expectNoItem(page, "weather-umbrella");
  // Deliberate difference from the prototype (which showed the toothbrush in both views): one canonical row, in Toiletries.
  await openCube(page, "Toiletries");
  await expect(row(page, "last-toothbrush")).toHaveCount(1);
  const all = await page
    .locator("[data-item-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-item-id")));
  expect(all.filter((id) => id === "last-toothbrush")).toHaveLength(1);
});

test("Nice outfits: switching off hides generic Nice clothing, switching back on restores edits and progress without personal assumptions", async ({
  page,
}) => {
  await openSanDiego(page);
  await expectItem(page, "nice-shoes");
  await expectNoItem(page, "nice-makeup");
  await expectNoItem(page, "nice-undergarments");

  await openEditor(page, "nice-shoes");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  // The cube stays in Edit list after its item sheet closes; return to the checklist before ticking it.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await tick(page, "nice-shoes");
  await expect(
    row(page, "nice-shoes").getByRole("checkbox", { name: "Dress shoes, 2" }),
  ).toBeChecked();

  for (let round = 0; round < 2; round += 1) {
    await setPreference(page, "Nice outfits", false);
    await expectNoItem(page, "nice-shoes");
    await expectNoItem(page, "nice-makeup");
    await expectNoItem(page, "nice-undergarments");
    await setPreference(page, "Nice outfits", true);
    await expectItem(page, "nice-shoes");
    await expect(
      (await showItem(page, "nice-shoes")).getByRole("checkbox", { name: "Dress shoes, 2" }),
    ).toBeChecked();
    await expectNoItem(page, "nice-makeup");
    await expectNoItem(page, "nice-undergarments");
  }
});

test("a removed optional item stays removed through later recalculations", async ({ page }) => {
  await openSanDiego(page);
  await openEditor(page, "nice-shoes");
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove item" }).click();
  await expectNoItem(page, "nice-shoes");
  await setPreference(page, "Laundry access", true);
  await expectNoItem(page, "nice-shoes");
  await setPreference(page, "Nice outfits", false);
  await setPreference(page, "Nice outfits", true);
  await expectNoItem(page, "nice-shoes");
  await page.reload();
  await expectNoItem(page, "nice-shoes");
});

test("copy: a remembered Bathroom item travels to the copy, with nothing checked, no assumed Makeup, and the source unchanged", async ({
  page,
}) => {
  await openSanDiego(page);
  // Remember a new Bathroom staple from this trip.
  await openCube(page, "Toiletries");
  await page.getByRole("button", { name: "＋ Add a Bathroom item" }).click();
  const add = page.getByRole("dialog", { name: "Add a Bathroom item" });
  await add.getByLabel("Item name").fill("Face wash");
  await add.getByRole("radio", { name: /Remember for future trips/ }).check();
  await add.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await page.goto("/");
  const source = page.getByRole("article", { name: "San Diego" });
  const before = await source.innerText();

  await chooseFromMenu(page, "San Diego", "Copy trip");
  await planAndCreate(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-12-04",
    end: "2026-12-08",
  });
  await expect(page.getByRole("article", { name: "Paris" })).toBeVisible();
  expect(await page.getByRole("article", { name: "San Diego" }).innerText()).toBe(before);

  await page.getByRole("link", { name: /(Continue|Keep) packing: Paris/ }).click();
  await expectPacking(page);
  await expectNoItem(page, "nice-makeup");
  await expectItem(page, "nice-shoes");
  await openCube(page, "Toiletries");
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await expect(page.locator("[data-item-id] input:checked")).toHaveCount(0);
  await expect(page.getByText("Toiletry bag is in the suitcase")).toHaveCount(0);
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
});

test("a tour of every screen raises no uncaught browser errors", DEVICE, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSanDiego(page);
  const id = new URL(page.url()).pathname.split("/").pop();
  for (const path of ["/", "/staples", "/settings", `/trips/${id}`, `/trips/${id}/review`, "/"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    // Next prefetches the linked screens once a page is up. Leaving while those requests are in flight cancels them, and WebKit
    // reports the cancelled fetch as an unhandled "Fetch API cannot load ... due to access control checks" from the router, which
    // is the browser unloading the page, not an error in the app. Let them finish before the next hard navigation.
    await page.waitForLoadState("networkidle");
  }
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(errors).toEqual([]);
});
