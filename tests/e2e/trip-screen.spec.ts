import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Fixed clock: San Diego is upcoming and partly packed, Lisbon is past, fully packed and Ready. In-memory data
// survives client-side navigation (links), not a reload, so every step navigates by clicking.
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

async function openLisbon(page: Page) {
  await openDashboard(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const TOILETRIES = [
  "nice-makeup",
  "last-toothbrush",
  "last-toothpaste",
  "last-deodorant",
  "last-contacts",
];
const status = (page: Page) => page.getByRole("status", { name: "Packing updates" });

async function packEverythingExceptBag(page: Page) {
  const ids = await page
    .locator("[data-item-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id") as string));
  // Bathroom items go last, because completing them opens the bag-placement prompt.
  for (const id of [...ids.filter((entry) => !TOILETRIES.includes(entry)), ...TOILETRIES]) {
    const pack = row(page, id).getByRole("button", { name: /^Pack all / });
    if (await pack.count()) await pack.click();
  }
}

test("shows the trip with progress, and the All / Still to pack filter", async ({ page }) => {
  await openSanDiego(page);
  await expect(page.getByRole("progressbar", { name: "Packing progress" })).toHaveAttribute(
    "aria-valuenow",
    "20",
  );
  await expect(page.getByText("Packing", { exact: true })).toBeVisible();
  await expect(row(page, "sleepwear")).toBeVisible();
  await page.getByRole("button", { name: "Still to pack" }).click();
  await expect(page.getByRole("button", { name: "Still to pack" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(row(page, "sleepwear")).toHaveCount(0);
  await expect(row(page, "underwear")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(row(page, "sleepwear")).toBeVisible();
});

test("check and uncheck, and partial quantities with announcements and limits", async ({
  page,
}) => {
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Pack all Everyday tops" }).click();
  await expect(
    row(page, "tops").getByRole("button", { name: "Mark Everyday tops unpacked" }),
  ).toHaveAttribute("aria-pressed", "true");
  await row(page, "tops").getByRole("button", { name: "Mark Everyday tops unpacked" }).click();
  await expect(
    row(page, "tops").getByRole("button", { name: "Pack all Everyday tops" }),
  ).toBeVisible();

  const underwear = row(page, "underwear");
  await expect(underwear).toContainText("2/4");
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).click();
  await expect(underwear).toContainText("3/4");
  await expect(status(page)).toHaveText("Underwear 3 of 4 packed");
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).click();
  await expect(
    underwear.getByRole("button", { name: "Increase packed Underwear" }),
  ).toHaveAttribute("aria-disabled", "true");
  // At the limit the button stays focusable but a press does nothing (Playwright treats aria-disabled as not clickable).
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).click({ force: true });
  await expect(underwear).toContainText("4/4");
  for (let n = 0; n < 4; n++)
    await underwear.getByRole("button", { name: "Decrease packed Underwear" }).click();
  await expect(
    underwear.getByRole("button", { name: "Decrease packed Underwear" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(underwear).toContainText("0/4");
});

test("the toiletry bag walks every state: waiting, ready to place, in the suitcase, undo, and invalidation", async ({
  page,
}) => {
  await openSanDiego(page);
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await expect(page.getByText("0 of 5 contents checked")).toBeVisible();

  for (const id of TOILETRIES.slice(0, 4))
    await row(page, id)
      .getByRole("button", { name: /^Pack all / })
      .click();
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await row(page, TOILETRIES[4])
    .getByRole("button", { name: /^Pack all / })
    .click();

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
  await expect(
    row(page, "last-toothbrush").getByRole("button", { name: "Mark Toothbrush unpacked" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  // Unchecking any content invalidates the placement.
  await row(page, "last-contacts").getByRole("button", { name: "Mark Contacts unpacked" }).click();
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
});

test("adding a Bathroom item after placing the bag resets the placement", async ({ page }) => {
  await openSanDiego(page);
  for (const id of TOILETRIES)
    await row(page, id)
      .getByRole("button", { name: /^Pack all / })
      .click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await page.getByRole("button", { name: "＋ Add a Bathroom item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a Bathroom item" });
  await dialog.getByLabel("Item name").fill("Face wash");
  await dialog.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.getByText("Face wash", { exact: true })).toBeVisible();
  await expect(page.getByText("Toiletry bag not ready to place")).toBeVisible();
  await expect(page.getByText("5 of 6 contents checked")).toBeVisible();
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
  await expect(page.getByText("Packing", { exact: true })).toBeVisible();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
});

test("a trip-only edit leaves the staples alone: a new trip still has the default", async ({
  page,
}) => {
  await openSanDiego(page);
  await row(page, "sunglasses").getByRole("button", { name: "Edit Sunglasses" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByLabel("Item name").fill("Beach sunglasses");
  await expect(dialog.getByRole("radio", { name: /This trip only/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sunglasses")).toContainText("Beach sunglasses");

  await page.getByRole("link", { name: "Back to trips" }).click();
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: /Paris/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page.getByRole("link", { name: "Keep packing: Paris" }).click();
  await expect(row(page, "sunglasses")).toContainText("Sunglasses");
  await expect(row(page, "sunglasses")).not.toContainText("Beach");
});

test("a remembered edit changes future trips, but neither this trip's history nor another existing trip", async ({
  page,
}) => {
  await openSanDiego(page);
  await row(page, "sunglasses").getByRole("button", { name: "Edit Sunglasses" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByLabel("Item name").fill("Polarized sunglasses");
  await dialog.getByRole("radio", { name: /Remember for future trips/ }).check();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sunglasses")).toContainText("Polarized sunglasses");

  // Another existing trip keeps its history.
  await page.getByRole("link", { name: "Back to trips" }).click();
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expect(row(page, "sunglasses")).toContainText("Sunglasses");
  await expect(row(page, "sunglasses")).not.toContainText("Polarized");

  // A trip made afterwards gets the remembered version.
  await page.getByRole("link", { name: "Back to trips" }).click();
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: /Paris/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page.getByRole("link", { name: "Keep packing: Paris" }).click();
  await expect(row(page, "sunglasses")).toContainText("Polarized sunglasses");
});

test("weather: nothing changes until accepted; accepting adds exactly one umbrella", async ({
  page,
}) => {
  await openSanDiego(page);
  await expect(page.getByText("Simulated · Close forecast")).toBeVisible();
  await expect(
    page.getByText("This is a simulated suggestion, not a real forecast.").first(),
  ).toBeVisible();
  await expect(row(page, "weather-umbrella")).toHaveCount(0);

  await page.getByRole("button", { name: "Review suggestion" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a compact umbrella?" });
  // The trip is not Ready, so the dialog does not warn that Ready will turn off.
  await expect(
    dialog.getByText("Accepting changes your list, so Ready will turn off."),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Simulated · skipped")).toBeVisible();
  await expect(row(page, "weather-umbrella")).toHaveCount(0);

  await page.getByRole("button", { name: "Review again" }).click();
  await page
    .getByRole("dialog", { name: "Add a compact umbrella?" })
    .getByRole("button", { name: "Accept umbrella" })
    .click();
  await expect(row(page, "weather-umbrella")).toHaveCount(1);
  await expect(page.getByText("Simulated · accepted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review suggestion" })).toHaveCount(0);
});

test("a trip whose umbrella was already accepted shows it once, with no suggestion to review", async ({
  page,
}) => {
  await openLisbon(page);
  await expect(page.getByText("You’re ready to go.")).toBeVisible();
  await expect(page.getByText("Simulated · accepted")).toBeVisible();
  await expect(row(page, "weather-umbrella")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Review suggestion" })).toHaveCount(0);
});

test("an optional item can be removed, after a confirmation that focuses the safe button", async ({
  page,
}) => {
  await openSanDiego(page);
  await row(page, "nice-shoes").getByRole("button", { name: "Edit Dress shoes" }).click();
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
  await expect(row(page, "nice-shoes")).toBeVisible();

  await row(page, "nice-shoes").getByRole("button", { name: "Edit Dress shoes" }).click();
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await expect(row(page, "nice-shoes")).toHaveCount(0);
});

test("a required item has no Remove button, and an empty name is refused", async ({ page }) => {
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Edit Everyday tops" }).click();
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
  const dialog = page.getByRole("dialog", { name: "Edit packing preferences" });
  await dialog.getByRole("switch", { name: "Laundry access" }).uncheck();
  await dialog.getByRole("button", { name: "Update this trip" }).click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await expect(page.getByText("Packing", { exact: true })).toBeVisible();
});

test("Mark as not ready keeps every packed count", async ({ page }) => {
  await openLisbon(page);
  const before = await page
    .getByRole("progressbar", { name: "Packing progress" })
    .getAttribute("aria-valuenow");
  await page.getByRole("button", { name: "Mark as not ready" }).click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Progress kept.");
  await expect(page.getByRole("progressbar", { name: "Packing progress" })).toHaveAttribute(
    "aria-valuenow",
    before ?? "",
  );
});

test("an unknown trip says so, with a way back", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
  await page.evaluate(() => window.history.pushState({}, "", "/trips/nope"));
  await page.goto("/trips/nope");
  await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
});

test("rows are keyboard operable with 44px targets, and nothing scrolls sideways at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openSanDiego(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const underwear = row(page, "underwear");
  const targets: [string, ReturnType<typeof underwear.getByRole>][] = [
    ["check", underwear.getByRole("button", { name: "Pack all Underwear" })],
    ["edit", underwear.getByRole("button", { name: "Edit Underwear" })],
    ["increase", underwear.getByRole("button", { name: "Increase packed Underwear" })],
    ["decrease", underwear.getByRole("button", { name: "Decrease packed Underwear" })],
    ["filter", page.getByRole("button", { name: "Still to pack" })],
  ];
  for (const [label, control] of targets) {
    const box = (await control.boundingBox())!;
    expect(box.height, `${label} height`).toBeGreaterThanOrEqual(43.9);
    expect(box.width, `${label} width`).toBeGreaterThanOrEqual(43.9);
  }
  await underwear.getByRole("button", { name: "Increase packed Underwear" }).focus();
  await page.keyboard.press("Enter");
  await expect(underwear).toContainText("3/4");
  await underwear.getByRole("button", { name: "Edit Underwear" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await expect(dialog.getByLabel("Item name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(underwear.getByRole("button", { name: "Edit Underwear" })).toBeFocused();
});

test("a sheet can be closed with its visible close button, and the bag button never wraps", async ({
  page,
}, testInfo) => {
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Edit Everyday tops" }).click();
  const close = page.getByRole("button", { name: "Close dialog" });
  const box = (await close.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(43.9);
  expect(box.height).toBeGreaterThanOrEqual(43.9);
  await close.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "tops").getByRole("button", { name: "Edit Everyday tops" })).toBeFocused();

  for (const id of TOILETRIES)
    await row(page, id)
      .getByRole("button", { name: /^Pack all / })
      .click();
  await page.getByRole("button", { name: "Not yet" }).click();
  const put = page.getByRole("button", { name: "Put bag in suitcase" });
  const card = page.locator(".bag-placement.pending");
  const putBox = (await put.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  // One line of text: about 44-52px tall, whatever the width.
  expect(putBox.height, testInfo.project.name).toBeLessThan(60);
  if (testInfo.project.name === "phone") expect(putBox.width).toBeGreaterThan(cardBox.width - 40);
});

// Design's screenshot set for the trip screen. "Not saved · Retry" is not here: the in-memory source cannot fail, so
// that state is covered by unit tests now and gets a real network-failure screenshot with the data-layer wiring.
test("screenshots of the trip screen", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string, fullPage = false) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-trip-${name}.png`,
      fullPage,
    });

  await openSanDiego(page);
  await shot("top");
  await row(page, "underwear").scrollIntoViewIfNeeded();
  await shot("partial-row");
  await shot("full", true);

  await row(page, "nice-shoes").getByRole("button", { name: "Edit Dress shoes" }).click();
  await shot("editor");
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await shot("remove-confirm");
  await page.getByRole("button", { name: "Keep item" }).click();
  await page.keyboard.press("Escape");

  await page.getByText("Toiletry bag not ready to place").scrollIntoViewIfNeeded();
  await shot("toiletries-waiting");
  for (const id of TOILETRIES)
    await row(page, id)
      .getByRole("button", { name: /^Pack all / })
      .click();
  await shot("bag-prompt");
  await page.getByRole("button", { name: "Not yet" }).click();
  await page.getByText("Toiletry bag ready to place").scrollIntoViewIfNeeded();
  await shot("toiletries-ready");
  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await shot("toiletries-in-suitcase");

  await page.getByRole("button", { name: "Edit preferences" }).click();
  await shot("preferences");
});

test("screenshots of the Ready trip, the weather card and its dialog", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-trip-${name}.png`,
    });
  await openLisbon(page);
  await expect(page.getByText("You’re ready to go.")).toBeVisible();
  await shot("ready");

  await page.getByRole("link", { name: "Back to trips" }).click();
  await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Review suggestion" }).scrollIntoViewIfNeeded();
  await shot("weather-card");
  await page.getByRole("button", { name: "Review suggestion" }).click();
  await expect(page.getByRole("dialog", { name: "Add a compact umbrella?" })).toBeVisible();
  await shot("weather-dialog");
});
