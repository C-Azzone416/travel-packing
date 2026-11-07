import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import {
  allItemIds,
  expectItem,
  expectNoItem,
  expectPacking,
  itemRow,
  openCube,
  openEditor,
  showItem,
  tick,
  untick,
} from "./helpers/packing";
import { reviewAndApply } from "./helpers/preferences";
import { planAndCreate } from "./helpers/plan";
import { planATrip, openPastAndArchive, openTripFromHome } from "./helpers/menu";

// The phone Home (#388) and the phone Pack mode (#386) are drawn below 1024px: this spec's flow starts on the Home and does not
// depend on the laptop layouts, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// The trip's Packing screen on its flows (saves, the toiletry bag, editing, Ready), at the width of each project: a laptop at
// 1440 on `desktop` and a phone on `phone`. The two layouts share the cube list, the rows and Edit list, so one spec serves
// both; what differs is in packing-laptop.spec.ts and packing-phone.spec.ts.
// Fixed clock: San Diego is upcoming and partly packed, Lisbon is past, fully packed and Ready.
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

async function openLisbon(page: Page) {
  await openDashboard(page);
  await openPastAndArchive(page);
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expectPacking(page);
}

const TOILETRIES = ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"];
const status = (page: Page) => page.getByRole("status", { name: "Packing updates" });

async function packEverythingExceptBag(page: Page) {
  const ids = await allItemIds(page);
  // Bathroom items go last, because completing them opens the bag-placement prompt.
  for (const id of [...ids.filter((entry) => !TOILETRIES.includes(entry)), ...TOILETRIES])
    await (await showItem(page, id)).getByRole("checkbox").check();
}

async function newParisTrip(page: Page) {
  await page.goto("/");
  await planATrip(page);
  await planAndCreate(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-11-12",
    end: "2026-11-16",
  });
  await openTripFromHome(page, "Paris");
  await expectPacking(page);
}

test("shows the count, and the To pack and Packed filters of the open cube", async ({ page }) => {
  await openSanDiego(page);
  await expect(page.getByText(/^6 of \d+ in the bag$/)).toBeVisible();
  await expect(itemRow(page, "sleepwear")).toBeVisible();
  await page.getByRole("button", { name: /^To pack/ }).click();
  await expect(page.getByRole("button", { name: /^To pack/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(itemRow(page, "sleepwear")).toHaveCount(0);
  await expect(itemRow(page, "underwear")).toBeVisible();
  await page.getByRole("button", { name: /^All \d/ }).click();
  await expect(itemRow(page, "sleepwear")).toBeVisible();
});

test("a tick packs the whole quantity and an untick packs none, announced each time", async ({
  page,
}) => {
  await openSanDiego(page);
  await tick(page, "tops");
  await expect(itemRow(page, "tops").getByRole("checkbox")).toBeChecked();
  await expect(status(page)).toHaveText("Everyday tops 4 of 4 packed");
  await untick(page, "tops");
  await expect(itemRow(page, "tops").getByRole("checkbox")).not.toBeChecked();
  await expect(status(page)).toHaveText("Everyday tops 0 of 4 packed");
  // Two of five underwear were packed in the seed: the tick shows it as partly done until it finishes the row.
  const underwear = itemRow(page, "underwear").getByRole("checkbox");
  expect(await underwear.evaluate((box: HTMLInputElement) => box.indeterminate)).toBe(true);
  await underwear.check();
  await expect(status(page)).toHaveText("Underwear 5 of 5 packed");
});

test("the toiletry bag walks every state: waiting, ready to place, in the suitcase, undo, and invalidation", async ({
  page,
}) => {
  await openSanDiego(page);
  await openCube(page, "Toiletries");
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await expect(page.getByText(/\(0 of 4 checked\)/)).toBeVisible();

  for (const id of TOILETRIES.slice(0, 3)) await tick(page, id);
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await tick(page, TOILETRIES[3]);

  // The last Bathroom item opens the placement prompt once; it never confirms by itself.
  const prompt = page.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Not yet" })).toBeFocused();
  await prompt.getByRole("button", { name: "Not yet" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();

  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();

  await page.getByRole("button", { name: "Undo placement" }).click();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
  await expect(itemRow(page, "last-toothbrush").getByRole("checkbox")).toBeChecked();

  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  // Unchecking any content invalidates the placement.
  await untick(page, "last-contacts");
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
});

test("adding a Bathroom item after placing the bag resets the placement", async ({ page }) => {
  await openSanDiego(page);
  for (const id of TOILETRIES) await tick(page, id);
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await page.getByRole("button", { name: "＋ Add a Bathroom item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a Bathroom item" });
  const itemName = dialog.getByLabel("Item name");
  await expect(itemName).toHaveAttribute("autocomplete", "off");
  await expect(itemName).toHaveAttribute("name", "packing-item-name");
  await expect(itemName.locator("xpath=ancestor::form")).toHaveAttribute("autocomplete", "off");
  await itemName.fill("Face wash");
  await dialog.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await expect(page.getByText(/\(4 of 5 checked\)/)).toBeVisible();
});

test("completing the last item only reveals Review your bag; it never marks the trip Ready", async ({
  page,
}) => {
  await openSanDiego(page);
  await packEverythingExceptBag(page);
  await page
    .getByRole("dialog", { name: "Toiletry bag in suitcase?" })
    .getByRole("button", { name: "Confirm" })
    .click();
  const review = page.getByRole("link", { name: "Review your bag" });
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute("href", /^\/trips\/[0-9a-f-]{36}\/review$/);
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
});

test("a trip-only edit leaves the staples alone: a new trip still has the default", async ({
  page,
}) => {
  await openSanDiego(page);
  await openEditor(page, "sunglasses");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByLabel("Item name").fill("Beach sunglasses");
  await expect(dialog.getByRole("radio", { name: /This trip only/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(itemRow(page, "sunglasses")).toContainText("Beach sunglasses");

  await newParisTrip(page);
  await expect(await showItem(page, "sunglasses")).toContainText("Sunglasses");
  await expect(itemRow(page, "sunglasses")).not.toContainText("Beach");
});

test("a remembered edit changes future trips, but neither this trip's history nor another existing trip", async ({
  page,
}) => {
  await openSanDiego(page);
  await openEditor(page, "sunglasses");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByLabel("Item name").fill("Polarized sunglasses");
  await dialog.getByRole("radio", { name: /Remember for future trips/ }).check();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(itemRow(page, "sunglasses")).toContainText("Polarized sunglasses");

  // Another existing trip keeps its history.
  await page.goto("/");
  await openPastAndArchive(page);
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expectPacking(page);
  await expect(await showItem(page, "sunglasses")).toContainText("Sunglasses");
  await expect(itemRow(page, "sunglasses")).not.toContainText("Polarized");

  // A trip made afterwards gets the remembered version.
  await newParisTrip(page);
  await expect(await showItem(page, "sunglasses")).toContainText("Polarized sunglasses");
});

test("weather: a trip with only curated places says it needs a map place, and adds nothing to the list", async ({
  page,
}) => {
  await openSanDiego(page);
  await expect(page.getByText("Weather needs a place from the map.")).toBeVisible();
  await expect(page.getByText(/Simulated/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /to review/ })).toHaveCount(0);
  await expectNoItem(page, "weather-umbrella");
});

test("a trip whose umbrella was already accepted shows it once, with no suggestion to review", async ({
  page,
}) => {
  await openLisbon(page);
  await expect(page.getByText("You’re ready to go.")).toBeVisible();
  await expect(page.getByText(/Simulated/)).toHaveCount(0);
  const ids = await allItemIds(page);
  expect(ids.filter((id) => id === "weather-umbrella")).toHaveLength(1);
});

test("an optional item can be removed, after a confirmation that focuses the safe button", async ({
  page,
}) => {
  await openSanDiego(page);
  await openEditor(page, "nice-shoes");
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  const confirm = page.getByRole("dialog", { name: "Remove Dress shoes?" });
  await expect(confirm.getByRole("button", { name: "Keep item" })).toBeFocused();
  await confirm.getByRole("button", { name: "Keep item" }).click();
  // Keeping the item returns to the editor; closing that leaves everything as it was.
  await expect(page.getByRole("dialog", { name: "Edit item" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectItem(page, "nice-shoes");

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
});

test("a required item has no Remove button, and an empty name is refused", async ({ page }) => {
  await openSanDiego(page);
  await openEditor(page, "tops");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await expect(dialog.getByRole("button", { name: "Remove item" })).toHaveCount(0);
  await dialog.getByLabel("Item name").fill("   ");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a name.");
  await expect(dialog.getByLabel("Item name")).toHaveAttribute("aria-invalid", "true");
});

test("editing preferences recalculates the list and revokes Ready", async ({ page }) => {
  await openLisbon(page);
  await expect(page.getByText("You’re ready to go.")).toBeVisible();
  await page.getByRole("button", { name: "Edit preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).uncheck();
  await reviewAndApply(page, dialog);
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
});

test("Mark as not ready keeps every packed count", async ({ page }) => {
  await openLisbon(page);
  const total = page.getByText(/^(\d+) of \1 in the bag$/);
  const before = await total.innerText();
  await page.getByRole("button", { name: "Mark as not ready" }).click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Progress kept.");
  await expect(total).toHaveText(before);
});

test("an unknown trip says so, with a way back", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await page.evaluate(() => window.history.pushState({}, "", "/trips/nope"));
  await page.goto("/trips/nope");
  await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
});

test(
  "rows are keyboard operable with 44px targets, and nothing scrolls sideways at 320px",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openSanDiego(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const underwear = itemRow(page, "underwear");
    // The whole row is the tick's label, so its height is the target (the pills are drawn 34px with a 44px tap area).
    const row = (await underwear.locator("label").boundingBox())!;
    expect(row.height, "row height").toBeGreaterThanOrEqual(43.9);
    const targets: [string, ReturnType<typeof page.getByRole>][] = [
      ["all in", page.getByRole("button", { name: /^All in/ })],
    ];
    for (const [label, control] of targets) {
      const box = (await control.boundingBox())!;
      expect(box.height, `${label} height`).toBeGreaterThanOrEqual(43.9);
    }
    const box = underwear.getByRole("checkbox");
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).toBeChecked();
    await page.getByRole("button", { name: "Edit list" }).focus();
    await page.keyboard.press("Enter");
    const edit = underwear.getByRole("button", { name: /^Edit / });
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(dialog.getByLabel("Item name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
  },
);

test(
  "a sheet can be closed with its visible close button, and the bag button never wraps",
  DEVICE,
  async ({ page }, testInfo) => {
    await openSanDiego(page);
    await openEditor(page, "tops");
    const close = page.getByRole("button", { name: "Close dialog" });
    const box = (await close.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.9);
    expect(box.height).toBeGreaterThanOrEqual(43.9);
    await close.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(itemRow(page, "tops").getByRole("button", { name: /^Edit / })).toBeFocused();

    for (const id of TOILETRIES) await tick(page, id);
    await page.getByRole("button", { name: "Not yet" }).click();
    const put = page.getByRole("button", { name: "Put bag in suitcase" });
    const card = page.locator(".bag-placement.pending");
    const putBox = (await put.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    // One line of text: about 44-52px tall, whatever the width.
    expect(putBox.height, testInfo.project.name).toBeLessThan(60);
    if (testInfo.project.name === "phone") expect(putBox.width).toBeGreaterThan(cardBox.width - 40);
  },
);

// Adding to a cube from Edit list (the old inline "＋ Add item" form is gone with the old page).
test("Edit list adds an unpacked item to the cube, never doubles it, and hands Bathroom to its form", async ({
  page,
}) => {
  await openSanDiego(page);
  await openCube(page, "Tech");
  await page.getByRole("button", { name: "Edit list" }).click();
  const field = page.getByPlaceholder("+ Add an item");
  await field.fill("Camera");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(status(page)).toHaveText("Camera added to Tech.");
  await expect(field).toHaveValue("");
  await expect(page.locator("[data-item-id]").filter({ hasText: "Camera" })).toHaveCount(1);

  // Saved for real: still there after a reload, still one row, and not packed.
  await page.reload();
  await openCube(page, "Tech");
  const camera = page.locator("[data-item-id]").filter({ hasText: "Camera" });
  await expect(camera).toHaveCount(1);
  await expect(camera.getByRole("checkbox")).not.toBeChecked();

  // The same item again is not added: the form says so and offers the quantity editor.
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.getByPlaceholder("+ Add an item").fill("  camera ");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/already on your list/)).toBeVisible();
  await expect(camera).toHaveCount(1);
  await page.getByRole("button", { name: "Edit its quantity" }).click();
  await expect(page.getByRole("dialog", { name: "Edit item" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Bathroom hands off to the existing form, filled in.
  await openCube(page, "Toiletries");
  await page.getByRole("button", { name: "＋ Add a Bathroom item" }).click();
  const bathroom = page.getByRole("dialog", { name: "Add a Bathroom item" });
  await bathroom.getByLabel("Item name").fill("Floss");
  await bathroom.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.locator("[data-item-id]").filter({ hasText: "Floss" })).toHaveCount(1);
});

test(
  "Edit list is keyboard operable and fits a phone without sideways scrolling",
  DEVICE,
  async ({ page }) => {
    await openSanDiego(page);
    await openCube(page, "Tech");
    await page.getByRole("button", { name: "Edit list" }).focus();
    await page.keyboard.press("Enter");
    const field = page.getByPlaceholder("+ Add an item");
    await field.focus();
    await page.keyboard.type("Charger cable");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-item-id]").filter({ hasText: "Charger cable" })).toHaveCount(
      1,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  },
);
