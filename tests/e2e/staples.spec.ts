import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// The Staples screen against a REAL Postgres (#18): what it shows after a reload is what was stored. Each test starts
// from this project's freshly seeded owner (the default staples, San Diego partly packed, Lisbon Ready).
const NOW = new Date("2026-10-16T12:00:00");

const staple = (page: Page, id: string) => page.locator(`[data-staple-id="${id}"]`);
const section = (page: Page, name: string) => page.getByRole("region", { name });
// The row's own button (its name starts with the staple's name; the editor's buttons do not).
const rowButton = (page: Page, id: string, name: string) =>
  staple(page, id).getByRole("button", { name: new RegExp(`^${name}`) });
const editorOf = (page: Page, name: string) => page.getByRole("group", { name: `Edit ${name}` });
// Staples save as they are changed: wait for the write the action causes before reloading or reading the database.
async function saved(page: Page, action: () => Promise<unknown>) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    action(),
  ]);
}

async function openStaples(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.goto("/staples");
  await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
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
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: destination }).click();
  await page.getByLabel("Leave", { exact: true }).fill(start);
  await page.getByLabel("Return", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Paris" })).toHaveCount(expectedCount);
}

async function underwearQty(page: Page, tripName: string): Promise<number> {
  await page
    .getByRole("link", { name: new RegExp(`(Continue|Keep) packing: ${tripName}`) })
    .click();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  const text = await page
    .locator('[data-item-id="underwear"] .qty-stepper span')
    .first()
    .innerText();
  await page.goBack();
  return Number(/of (\d+) packed/.exec(text)?.[1]);
}

test("edit a staple count: existing trips are unchanged, and the next new trip uses the new value", async ({
  page,
}) => {
  await openStaples(page);
  await page.goto("/");
  await newTrip(page, /Paris/, "2026-12-04", "2026-12-08", 1);
  const sanDiegoBefore = await underwearQty(page, "San Diego");
  const parisBefore = await underwearQty(page, "Paris");

  await page.goto("/staples");
  await expect(section(page, "Clothing")).toBeVisible();
  await rowButton(page, "underwear", "Underwear").click();
  const editor = editorOf(page, "Underwear");
  await saved(page, () => editor.getByRole("button", { name: /^More / }).click());
  // The row shows what a new 4-night trip starts with: 2 per day over 4 everyday days, plus the spare.
  await expect(staple(page, "underwear")).toContainText("× 9");
  await page.reload();
  await expect(staple(page, "underwear")).toContainText("per day");
  await expect(staple(page, "underwear")).toContainText("× 9");

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
  // "N of M packed": M is the needed count for the trip.
  expect(Number(/of (\d+) packed/.exec(text)?.[1])).toBeGreaterThan(parisBefore);
});

test("add a staple to a cube: it is stored, per trip, and Pack last starts off", async ({
  page,
}) => {
  await openStaples(page);
  await page.getByRole("textbox", { name: "Staple name" }).fill("Phone charger");
  await page.getByRole("combobox", { name: "Cube for the new staple" }).selectOption("tech");
  await saved(page, () => page.getByRole("button", { name: "Add staple" }).click());
  await expect(section(page, "Tech").getByText("Phone charger")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Staple name" })).toHaveValue("");
  await page.reload();
  const row = section(page, "Tech")
    .locator("[data-staple-id]")
    .filter({ hasText: "Phone charger" });
  await expect(row).toContainText("per trip");
  await expect(row).toContainText("× 1");
  await expect(row).not.toContainText("Pack last");
});

test("a duplicate name is refused with a way to edit the existing staple", async ({ page }) => {
  await openStaples(page);
  await page.getByRole("textbox", { name: "Staple name" }).fill("socks");
  await page.getByRole("button", { name: "Add staple" }).click();
  await expect(page.getByText("You already have Socks.")).toBeVisible();
  await page.getByRole("button", { name: "Edit it instead" }).click();
  await expect(editorOf(page, "Socks")).toBeVisible();
});

test("change how a staple scales and mark it ↻: the preview halves it with laundry on", async ({
  page,
}) => {
  await openStaples(page);
  const slider = page.getByRole("slider", { name: "Preview a trip of" });
  await expect(slider).toHaveAttribute("aria-valuetext", "4 nights");
  await rowButton(page, "sleepwear", "Sleepwear").click();
  const editor = editorOf(page, "Sleepwear");
  await expect(staple(page, "sleepwear")).toContainText("× 1");
  await saved(page, () => editor.getByRole("button", { name: "per day" }).click());
  await expect(staple(page, "sleepwear")).toContainText("× 5");
  await saved(page, () => editor.getByRole("switch", { name: "Fewer with laundry" }).click());
  // Laundry is on in the preview: 5 halves to 3, and the preview says what it saved.
  await expect(staple(page, "sleepwear").locator("del")).toHaveText("× 5");
  await expect(staple(page, "sleepwear").locator("ins")).toHaveText("× 3");
  await expect(page.getByText("Laundry saves 2 (anything marked ↻ is halved).")).toBeVisible();
  await page.getByRole("switch", { name: "Laundry on the trip" }).uncheck();
  await expect(staple(page, "sleepwear")).toContainText("× 5");
  await expect(staple(page, "sleepwear").locator("del")).toHaveCount(0);
  await expect(
    page.getByText("Laundry would save 2. Underwear and socks stay one per day."),
  ).toBeVisible();
  // The cadence and the flag are stored.
  await page.reload();
  await expect(staple(page, "sleepwear")).toContainText("per day");
  await expect(staple(page, "sleepwear").getByText("Fewer with laundry")).toHaveCount(1);
  // Per night is reachable too: 4 nights is 4.
  await rowButton(page, "sleepwear", "Sleepwear").click();
  await saved(page, () =>
    editorOf(page, "Sleepwear").getByRole("button", { name: "per night" }).click(),
  );
  await expect(staple(page, "sleepwear")).toContainText("× 4");
});

test("underwear and socks cannot carry ↻, and say why", async ({ page }) => {
  await openStaples(page);
  await rowButton(page, "underwear", "Underwear").click();
  const toggle = editorOf(page, "Underwear").getByRole("switch", { name: "Fewer with laundry" });
  await expect(toggle).toBeDisabled();
  await expect(
    page.getByText("Underwear and socks stay one per day, with or without laundry."),
  ).toBeVisible();
});

test("the preview slider scales the per-day counts", async ({ page }) => {
  await openStaples(page);
  const slider = page.getByRole("slider", { name: "Preview a trip of" });
  await slider.fill("10");
  await expect(slider).toHaveAttribute("aria-valuetext", "10 nights");
  await expect(staple(page, "underwear")).toContainText("× 11");
  await expect(staple(page, "last-toothbrush")).toContainText("× 1");
  await slider.fill("1");
  await expect(slider).toHaveAttribute("aria-valuetext", "1 night");
  await expect(staple(page, "underwear")).toContainText("× 2");
});

test("move a staple to another cube", async ({ page }) => {
  await openStaples(page);
  await rowButton(page, "sleepwear", "Sleepwear").click();
  await saved(page, () =>
    page.getByRole("combobox", { name: "Cube for Sleepwear" }).selectOption("misc"),
  );
  await expect(section(page, "Misc").locator('[data-staple-id="sleepwear"]')).toBeVisible();
  await page.reload();
  await expect(section(page, "Misc").locator('[data-staple-id="sleepwear"]')).toBeVisible();
  await expect(section(page, "Clothing").locator('[data-staple-id="sleepwear"]')).toHaveCount(0);
});

test("Pack last is a switch in the editor and a badge on the row", async ({ page }) => {
  await openStaples(page);
  await expect(staple(page, "sunglasses")).not.toContainText("Pack last");
  await rowButton(page, "sunglasses", "Sunglasses").click();
  await saved(page, () =>
    editorOf(page, "Sunglasses").getByRole("switch", { name: "Pack last" }).check(),
  );
  await expect(staple(page, "sunglasses")).toContainText("Pack last");
  await page.reload();
  await expect(staple(page, "sunglasses")).toContainText("Pack last");
});

test("remove a staple from future trips", async ({ page }) => {
  await openStaples(page);
  await rowButton(page, "sleepwear", "Sleepwear").click();
  await saved(page, () =>
    editorOf(page, "Sleepwear").getByRole("button", { name: "Remove" }).click(),
  );
  await expect(staple(page, "sleepwear")).toHaveCount(0);
  await page.reload();
  await expect(section(page, "Clothing")).toBeVisible();
  await expect(staple(page, "sleepwear")).toHaveCount(0);
});

test("one owner's staples are not another's", async ({ page, browser }) => {
  await openStaples(page);
  await page.getByRole("textbox", { name: "Staple name" }).fill("Only mine");
  await saved(page, () => page.getByRole("button", { name: "Add staple" }).click());
  await expect(page.locator("[data-staple-id]").getByText("Only mine")).toBeVisible();

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    const { SECOND_EMAIL, signIn } = await import("./helpers/auth");
    await signIn(second, SECOND_EMAIL);
    await expect(second).toHaveURL(/\/$/);
    await second.goto("/staples");
    await expect(second.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
    await expect(second.getByRole("region", { name: "Clothing" })).toBeVisible();
    await expect(second.getByText("Only mine")).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test(
  "controls are 44px targets on phone, the sheet edits a staple, and nothing scrolls sideways",
  DEVICE,
  async ({ page }, testInfo) => {
    await openStaples(page);
    if (testInfo.project.name === "phone") {
      for (const control of [
        rowButton(page, "underwear", "Underwear"),
        page.getByRole("button", { name: "Add staple" }),
      ]) {
        await expect(control).toBeVisible();
        // Layout can land a hair under 44 (43.99997); a target is 44px for every practical purpose.
        expect(Math.round((await control.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
      }
      // A row opens the bottom sheet: cube chips, a stepper, the cadence chips, Fewer with laundry, Remove and Done.
      await rowButton(page, "sleepwear", "Sleepwear").click();
      const sheet = page.getByRole("dialog", { name: "Sleepwear" });
      await expect(sheet.getByRole("radio", { name: "Clothing" })).toBeChecked();
      await saved(page, () => sheet.getByRole("button", { name: /^More / }).click());
      await saved(page, () => sheet.getByRole("button", { name: "per night" }).click());
      await sheet.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(staple(page, "sleepwear")).toContainText("per night");
      await expect(staple(page, "sleepwear")).toContainText("× 8");
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  },
);

test("screenshots of the staples screen", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string, fullPage = true) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-staples-${name}.png`,
      fullPage,
    });
  await openStaples(page);
  await shot("all");
  if (testInfo.project.name === "phone") {
    await rowButton(page, "last-toothbrush", "Toothbrush").click();
    await expect(page.getByRole("dialog", { name: "Toothbrush" })).toBeVisible();
    await shot("sheet", false);
    await page.getByRole("button", { name: "Done" }).click();
  } else {
    await rowButton(page, "last-toothbrush", "Toothbrush").click();
    await expect(editorOf(page, "Toothbrush")).toBeVisible();
    await shot("editor-open");
  }
  await page.getByRole("textbox", { name: "Staple name" }).fill("socks");
  await page.getByRole("button", { name: "Add staple" }).click();
  await shot("duplicate", false);
});

// Design's re-check of #384: the phone dock is drawn about 125px tall (st-p-ocean), and the staple sheet keeps Remove and Done
// on screen at 195×844 and 390×640 (its fields scroll inside it).
test("the phone dock keeps to its drawn height, and the sheet keeps Remove and Done on screen", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsOwner(page);
  await page.goto("/staples");
  await expect(section(page, "Clothing")).toBeVisible();
  const dock = page.getByRole("complementary", { name: "Preview" });
  await expect(page.getByRole("button", { name: /^Preview:/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(130);

  for (const size of [
    { width: 195, height: 844 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await rowButton(page, "sleepwear", "Sleepwear").click();
    const sheet = page.getByRole("dialog", { name: "Sleepwear" });
    await expect(sheet).toBeVisible();
    for (const name of ["Remove", "Done"]) {
      const box = (await sheet.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }
    // The laundry pill keeps "On"/"Off" on its right edge, even at 195.
    const pill = sheet.getByRole("switch", { name: "Fewer with laundry" });
    const state = pill.locator("span").last();
    const [pillBox, stateBox] = [(await pill.boundingBox())!, (await state.boundingBox())!];
    expect(pillBox.x + pillBox.width - (stateBox.x + stateBox.width)).toBeLessThan(30);
    expect(stateBox.y).toBeGreaterThan(pillBox.y - 1);
    await sheet.getByRole("button", { name: "Done" }).scrollIntoViewIfNeeded();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});
