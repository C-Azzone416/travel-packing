import { expect, test, type Page } from "@playwright/test";
import { SECOND_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import {
  expectNoItem,
  expectPacking,
  openCube,
  openEditor,
  readyRibbon,
  showItem,
  tick,
  untick,
} from "./helpers/packing";
import { phoneHomeLayout } from "./helpers/device";
import { reviewAndApply } from "./helpers/preferences";
import { openPastAndArchive } from "./helpers/menu";
import { serverActionId } from "./helpers/server-action";

// The phone Home (#388) and the phone Pack mode (#386) are drawn below 1024px: this spec's flow starts on the Home and does not
// depend on the laptop layouts, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// The trip screen against a REAL Postgres: what it shows after a reload is what was stored. Each test starts from the
// freshly seeded state of this project's owner (San Diego partly packed, Lisbon past, Ready, weather accepted).
const NOW = new Date("2026-10-16T12:00:00");

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const TOILETRIES = ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"];

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

async function openLisbon(page: Page) {
  await openDashboard(page);
  await openPastAndArchive(page);
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expectPacking(page);
}

/** Server actions are POSTs to the page's own URL. */
const isAction = (request: { method(): string; url(): string }) =>
  request.method() === "POST" && new URL(request.url()).pathname.startsWith("/trips/");

test("a check and an uncheck are stored", async ({ page }) => {
  await openSanDiego(page);
  await tick(page, "tops");
  await expect(row(page, "tops").getByRole("checkbox")).toBeChecked();
  await page.reload();
  await expect((await showItem(page, "tops")).getByRole("checkbox")).toBeChecked();
  await untick(page, "tops");
  await expect(row(page, "tops").getByRole("checkbox")).not.toBeChecked();
  await page.reload();
  await expect((await showItem(page, "tops")).getByRole("checkbox")).not.toBeChecked();
});

test("a tick shows at once and is stored as ONE write for the whole quantity", async ({ page }) => {
  await openSanDiego(page);
  // Opening the screen also fires READ actions a little AFTER the screen shows, and they are POSTs to the same URL (#478). They are
  // excluded by their action id (never by a guess at the body), so ANY other POST, to this item or another, counts as a write.
  const reads = new Set(
    [
      ["src/features/trips/trip-actions.ts", "getTripAction"],
      ["src/features/trips/trip-actions.ts", "listStaplesAction"],
      ["src/features/trips/trip-actions.ts", "getHomeCityAction"],
      ["src/features/trips/trip-actions.ts", "getStaplesSetupAction"],
      ["src/features/trips/trip-actions.ts", "listWeatherSuggestionsAction"],
      ["src/features/settings/weather-actions.ts", "getWeatherSettingsAction"],
      ["src/features/trips/actions.ts", "loadTripsAction"],
    ].map(([file, name]) => serverActionId(file, name)),
  );
  const setPacked = serverActionId("src/features/trips/trip-actions.ts", "setPackedAction");
  const writes: string[] = [];
  page.on("request", (request) => {
    const action = request.headers()["next-action"] ?? "";
    if (isAction(request) && !reads.has(action)) writes.push(action);
  });
  const socks = (await showItem(page, "socks")).getByRole("checkbox");
  await expect(socks).not.toBeChecked();
  await socks.check();
  await expect(socks).toBeChecked();
  await expect.poll(() => writes.length).toBe(1);
  await page.waitForTimeout(600);
  expect(writes).toEqual([setPacked]);
  await page.reload();
  await expect((await showItem(page, "socks")).getByRole("checkbox")).toBeChecked();
});

test("the toiletry bag gate and its placement are stored", async ({ page }) => {
  await openSanDiego(page);
  for (const id of TOILETRIES) await tick(page, id);
  await page.getByRole("button", { name: "Not yet" }).click();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await page.reload();
  await openCube(page, "Toiletries");
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();

  await page.getByRole("button", { name: "Undo placement" }).click();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
  await page.reload();
  await openCube(page, "Toiletries");
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
});

test("Mark as not ready is stored, and keeps every packed count", async ({ page }) => {
  await openLisbon(page);
  await expect(readyRibbon(page)).toBeVisible();
  const total = page.getByText(/^(\d+) of \1 in the bag$/);
  await expect(total).toBeVisible();
  const before = await total.innerText();
  await page.getByRole("button", { name: "Mark as not ready" }).click();
  await expect(readyRibbon(page)).toHaveCount(0);
  await page.reload();
  await expectPacking(page);
  await expect(readyRibbon(page)).toHaveCount(0);
  await expect(page.getByText(before, { exact: true })).toBeVisible();
});

test("changing a Ready trip revokes Ready, and that is stored too", async ({ page }) => {
  await openLisbon(page);
  await page.getByRole("button", { name: "Edit preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).uncheck();
  await reviewAndApply(page, dialog);
  await expect(readyRibbon(page)).toHaveCount(0);
  await page.reload();
  await expectPacking(page);
  await expect(readyRibbon(page)).toHaveCount(0);
});

test("an edit and a removal are stored", async ({ page }) => {
  await openSanDiego(page);
  await openEditor(page, "sunglasses");
  const editor = page.getByRole("dialog", { name: "Edit item" });
  await editor.getByLabel("Item name").fill("Polarized sunglasses");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sunglasses")).toContainText("Polarized sunglasses");

  await openEditor(page, "nice-shoes");
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await expectNoItem(page, "nice-shoes");

  await page.reload();
  await expect(await showItem(page, "sunglasses")).toContainText("Polarized sunglasses");
  await expectNoItem(page, "nice-shoes");
});

test("when the network fails the row says 'Not saved · Retry', keeps the user's count, and Retry stores it", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSanDiego(page);
  await page.route("**/trips/**", (route) =>
    isAction(route.request()) ? route.abort("failed") : route.continue(),
  );
  const socks = await showItem(page, "socks");
  await socks.getByRole("checkbox").check();
  const retry = socks.getByRole("button", { name: "Not saved · Retry" });
  await expect(retry).toBeVisible();
  // Design: the row's Retry has a 44px hit area.
  const retryBox = (await retry.boundingBox())!;
  expect(retryBox.height).toBeGreaterThanOrEqual(43.9);
  expect(retryBox.width).toBeGreaterThanOrEqual(43.9);
  await expect(socks.getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("button", { name: "Not saved, retry" })).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-trip-not-saved.png`,
  });

  await page.unroute("**/trips/**");
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect((await showItem(page, "socks")).getByRole("checkbox")).toBeChecked();
});

test("another signed-in owner cannot open this owner's trip, and sees the same page as for a missing one", async ({
  page,
  browser,
}) => {
  await openDashboard(page);
  const href = await page
    .getByRole("link", { name: "Continue packing: San Diego" })
    .getAttribute("href");
  const second = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await second.newPage();
  await signIn(other, SECOND_EMAIL);
  await expect(other).toHaveURL(/\/$/);
  await other.goto(href as string);
  await expect(other.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
  await expect(other.getByText("San Diego")).toHaveCount(0);
  await second.close();
});
