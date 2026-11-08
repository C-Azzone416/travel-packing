import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import {
  expectNoItem,
  expectPacking,
  openCube,
  openEditor,
  showItem,
  tick,
} from "./helpers/packing";
import { openPastAndArchive, chooseFromMenu } from "./helpers/menu";

// The phone Home (#388) and the phone Pack mode (#386) are drawn below 1024px: this spec's flow starts on the Home and does not
// depend on the laptop layouts, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// Edit trip (#203, #389): the route and dates and the packing preferences in one sheet, with a live "What changes in your list"
// panel beside the edits. Real app, real database. The merge rules themselves are unit-tested (item-ops, recalc-preview,
// edit-diff); these tests prove the sheet shows them truthfully and that the stored list keeps the person's work.
const NOW = new Date("2026-10-16T12:00:00");

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
/** The needed quantity of an item: its tick is named "Everyday tops, 4" (the quantity is only in the name when it is more than one). */
async function qtyOf(page: Page, id: string) {
  const name = await (await showItem(page, id)).getByRole("checkbox").getAttribute("aria-label");
  return Number(/, (\d+)/.exec(name ?? "")?.[1] ?? 1);
}
const sheet = (page: Page) => page.getByRole("dialog", { name: "Edit trip" });
const save = (page: Page) => sheet(page).getByRole("button", { name: /^Save \d+ changes?$/ });
const section = (page: Page, name: string) => sheet(page).getByRole("button", { name });
const changesList = (page: Page) =>
  sheet(page).getByRole("list", { name: "What changes in your list" });

/** Below 1024px the list of changes can be folded away behind "See what moves": open it (a no-op on the laptop sheet). */
async function showChanges(page: Page) {
  const moves = sheet(page).getByRole("button", { name: /See what moves/ });
  if ((await moves.isVisible()) && (await moves.getAttribute("aria-expanded")) === "false")
    await moves.click();
  await expect(changesList(page)).toBeVisible();
}

/** The sheet's own "Edit preferences" entry (Trip math); a click that lands before the page is interactive is repeated. */
async function openPreferences(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Edit preferences" }).click();
    await expect(sheet(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
  return sheet(page);
}

test("Edit trip has three ways in: the dashboard, the packing hero and Trip math, each on the right section", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await chooseFromMenu(page, "San Diego", "Edit trip");
  await expect(section(page, "Route & dates")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  await page.getByRole("button", { name: "Edit trip" }).click();
  await expect(section(page, "Route & dates")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");

  const dialog = await openPreferences(page);
  await expect(section(page, "Packing preferences")).toHaveAttribute("aria-expanded", "true");
  // Pre-filled from the saved trip, not defaults: San Diego has Nice outfits on, with one occasion.
  await expect(dialog.getByRole("switch", { name: "Nice outfits" })).toBeChecked();
  await expect(dialog.getByLabel("Occasions")).toHaveValue("1");
  await expect(
    dialog.getByRole("switch", { name: "Dedicated return travel outfit" }),
  ).toBeChecked();
});

test("a recalculation keeps the person's list work: manual, edited, packed and removed items, stored", async ({
  page,
}) => {
  await openSanDiego(page);
  // The person's work: a manual item, an edited suggestion, packed progress, and a removed optional suggestion.
  await openCube(page, "Tech");
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.getByPlaceholder("+ Add an item").fill("Camera");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(1);
  await openEditor(page, "sleepwear");
  const editor = page.getByRole("dialog", { name: "Edit item" });
  await editor.getByLabel("Item name").fill("Pajamas");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sleepwear")).toContainText("Pajamas");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await tick(page, "underwear");
  await expect(row(page, "underwear").getByRole("checkbox")).toBeChecked();
  await openEditor(page, "nice-shoes");
  await page.getByRole("button", { name: "Remove item" }).click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: /Remove/ })
    .last()
    .click();
  await expectNoItem(page, "nice-shoes");

  await showItem(page, "tops"); // the cube that holds it stays showing behind the sheet
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  // The panel updates as the switch moves: the preference, then each item whose quantity changes, old → new.
  await showChanges(page);
  const changes = changesList(page);
  await expect(changes).toContainText("Laundry");
  await expect(changes.getByRole("listitem").filter({ hasText: "Everyday tops" })).toContainText(
    "× 4",
  );
  // What stays is said once, not listed: the person's own work never appears as a change.
  await expect(
    dialog.getByText(/Items you added or edited yourself stay as they are/),
  ).toBeVisible();
  await expect(changes).not.toContainText("Camera");
  await expect(changes).not.toContainText("Pajamas");
  await expect(changes).not.toContainText("Dress shoes");
  // Nothing is saved until Save: the list behind the sheet is unchanged.
  // (read from the row's own checkbox, which the open sheet leaves in the page; the cube that holds it was opened before the sheet)
  await expect(page.locator('[data-item-id="tops"] input[type="checkbox"]')).toHaveAttribute(
    "aria-label",
    "Everyday tops, 4",
  );
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Preferences updated.");

  // After a reload, from the database: the untouched suggestion followed the new preference; the person's work is intact.
  await page.reload();
  expect(await qtyOf(page, "tops")).toBe(2);
  await expect(await showItem(page, "sleepwear")).toContainText("Pajamas");
  await expect((await showItem(page, "underwear")).getByRole("checkbox")).toBeChecked();
  await openCube(page, "Tech");
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(1);
  await expectNoItem(page, "nice-shoes");
});

test("a packed count above the new target is shown, needs an acknowledgement, and is lowered to the target", async ({
  page,
}) => {
  await openSanDiego(page);
  await tick(page, "tops");
  await expect(row(page, "tops").getByRole("checkbox", { name: "Everyday tops, 4" })).toBeChecked();
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await showChanges(page);
  await expect(dialog.getByText("Packed 4 → 2")).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I understand/ }).check();
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  const tops = (await showItem(page, "tops")).getByRole("checkbox", { name: "Everyday tops, 2" });
  await expect(tops).toBeChecked();
});

test("Undo all, Cancel and Escape leave the trip unchanged, and ask nothing: nothing was saved", async ({
  page,
}) => {
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await expect(section(page, "Packing preferences").getByRole("img")).toBeVisible(); // the dot
  await expect(dialog.getByRole("button", { name: /^Save \d+ changes$/ })).toBeEnabled();
  await dialog.getByRole("button", { name: "Undo all" }).click();
  await expect(dialog.getByRole("switch", { name: "Laundry on this trip" })).not.toBeChecked();
  await expect(section(page, "Packing preferences").getByRole("img")).toHaveCount(0);
  await expect(dialog.getByText("No changes yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet(page)).toHaveCount(0);
  const again = await openPreferences(page);
  await expect(again.getByRole("switch", { name: "Laundry on this trip" })).not.toBeChecked();
  await again.getByRole("switch", { name: "Laundry on this trip" }).check();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  expect(await qtyOf(page, "tops")).toBe(4);
  const last = await openPreferences(page);
  await expect(last.getByRole("switch", { name: "Laundry on this trip" })).not.toBeChecked();
});

test("a list the trip has moved on from is refused: you are told, selections kept, and Save again works", async ({
  page,
  context,
}) => {
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  // Another tab (the same signed-in person) packs something while this sheet is open.
  const other = await context.newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto(page.url());
  const socks = other.locator('[data-item-id="socks"]');
  // A tick is sent at once: wait for the write that carries it, then a reload shows it stored.
  const written = other.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes("socks"),
  );
  await socks.getByRole("checkbox").check();
  await expect(socks.getByRole("checkbox")).toBeChecked();
  await written;
  await other.reload();
  await expect(other.locator('[data-item-id="socks"]').getByRole("checkbox")).toBeChecked();
  await other.close();
  await save(page).click();
  await expect(dialog.getByText(/Your list changed while you were editing/)).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Laundry on this trip" })).toBeChecked();
  // The sheet has the current list now, so saving again works.
  await expect(async () => {
    await dialog
      .getByRole("checkbox", { name: /I understand/ })
      .check({ timeout: 500 })
      .catch(() => undefined);
    await save(page).click({ timeout: 2000 });
    await expect(sheet(page)).toHaveCount(0, { timeout: 2000 });
  }).toPass();
});

test("Ready turns off with a preference change, and the panel says so first", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await openPastAndArchive(page);
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expectPacking(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).uncheck();
  await showChanges(page);
  await expect(dialog.getByText(/Ready turns off/)).toBeVisible();
  const acknowledge = dialog.getByRole("checkbox", { name: /I understand/ });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Ready turned off.");
});

test("dates and getting there: the live panel shows old → new, Save N changes stores them", async ({
  page,
}) => {
  await openSanDiego(page);
  await page.getByRole("button", { name: "Edit trip" }).click();
  const dialog = sheet(page);
  await expect(dialog.getByText("4 nights")).toBeVisible();
  await dialog.getByRole("button", { name: "One night more" }).click();
  await dialog.getByRole("button", { name: "One night more" }).click();
  await dialog.getByRole("radio", { name: "Drive" }).check();
  await expect(section(page, "Route & dates").getByRole("img")).toBeVisible();
  await showChanges(page);
  await expect(dialog.getByText("4 → 6 nights")).toBeVisible();
  const changes = changesList(page);
  await expect(changes.getByRole("listitem").filter({ hasText: "Dates" })).toContainText("→");
  await expect(changes.getByRole("listitem").filter({ hasText: "Getting there" })).toContainText(
    "Drive",
  );
  await expect(changes.getByRole("listitem").filter({ hasText: "Underwear" })).toContainText("×");
  // The button counts exactly the rows listed.
  const rows = await changes.getByRole("listitem").count();
  await expect(save(page)).toHaveText(`Save ${rows} changes`);
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "Edit trip" }).click();
  await expect(sheet(page).getByText("6 nights")).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: "Drive" })).toBeChecked();
});

test("stops can be moved with buttons and removed, and the panel says what each did", async ({
  page,
}) => {
  await openSanDiego(page);
  await page.getByRole("button", { name: "Edit trip" }).click();
  const dialog = sheet(page);
  await dialog.getByRole("button", { name: "Add a stop" }).click();
  await dialog.getByRole("combobox", { name: "Destination search, Stop 2" }).fill("lisbon");
  await dialog.getByRole("option").first().click();
  await showChanges(page);
  const changes = changesList(page);
  await expect(changes.getByRole("listitem").filter({ hasText: "Lisbon" })).toContainText(
    "new stop",
  );
  await dialog.getByRole("button", { name: "Move Lisbon up" }).click();
  await expect(dialog.getByRole("button", { name: "Move San Diego down" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove Lisbon" }).click();
  await expect(dialog.getByText("No changes yet.", { exact: true })).toBeVisible();
});

test("the old review address forwards to the trip with ?review=1", async ({ page }) => {
  await openSanDiego(page);
  const id = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/trips/${id}/review`);
  await expect(page).toHaveURL(new RegExp(`/trips/${id}\\?review=1$`));
  await expect(page.getByRole("heading", { name: "Review your bag", level: 1 })).toBeVisible();
});

test(
  "the sheet is accessible and fits a phone: axe on both sections, 44px targets, no sideways scroll",
  DEVICE,
  async ({ page }) => {
    await openSanDiego(page);
    const dialog = await openPreferences(page);
    await expectAccessible(page, "edit trip, preferences open", { include: '[role="dialog"]' });
    await dialog.getByRole("switch", { name: "Nice outfits" }).uncheck();
    await expect(dialog.getByText("Turn on Nice outfits to set occasions.")).toBeVisible();
    await expectAccessible(page, "edit trip, Nice off with its hint", {
      include: '[role="dialog"]',
    });
    await section(page, "Route & dates").click();
    await expectAccessible(page, "edit trip, route open with changes", {
      include: '[role="dialog"]',
    });
    for (const control of [
      dialog.getByRole("button", { name: /^Save \d+ changes?$/ }),
      dialog.getByRole("button", { name: "Cancel" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
      // The footer is reachable without scrolling the sheet.
      await expect(control).toBeInViewport();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  },
);

// 195px is the hard target (#332): the sheet must not scroll sideways, the pinned panel and its Save button stay in view, and
// words wrap whole (no text clipped by its own box). The pin fails on the old sheet (no Save button, a 640px dialog).
test("at 195px the sheet and its live panel fit: no sideways scroll, Save in view, nothing clipped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 195, height: 640 });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await dialog.getByRole("switch", { name: "One spare underwear + socks" }).uncheck();
  await section(page, "Route & dates").click();
  await dialog.getByRole("radio", { name: "Drive" }).check();
  // The changes are the widest thing on the sheet: look at them open.
  await showChanges(page);
  await expect(changesList(page).getByRole("listitem").first()).toBeVisible();
  // The page behind the sheet is inert and has its own 195px work (#332); what matters here is the sheet: as wide as the screen
  // and no wider, with nothing in it that scrolls or is cut off sideways.
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(195);
  expect(box.x).toBeGreaterThanOrEqual(0);
  const scrolls = await dialog.evaluate((root) => [
    root.scrollWidth - root.clientWidth,
    ...[...root.querySelectorAll<HTMLElement>("[data-edit-body]")].map(
      (body) => body.scrollWidth - body.clientWidth,
    ),
  ]);
  expect(scrolls).toEqual(scrolls.map(() => 0));
  await expect(save(page)).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
  // Nothing inside the sheet is wider than the sheet, and no text box is clipped by its own overflow.
  const overflowing = await dialog.evaluate((root) => {
    const rootBox = root.getBoundingClientRect();
    const bad: string[] = [];
    for (const node of root.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || node.closest("[hidden], .sr-only")) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.right > rootBox.right + 0.5)
        bad.push(`${node.tagName} ${node.className}`);
      if (
        node.scrollWidth > node.clientWidth + 1 &&
        style.overflowX !== "visible" &&
        node.clientWidth > 0
      )
        bad.push(`clipped ${node.tagName} ${node.className}`);
    }
    return bad;
  });
  expect(overflowing).toEqual([]);
  // Words wrap whole: no row label or value breaks inside a word (a long word would only wrap if it must).
  const longest = await dialog.evaluate((root) => {
    let widest = 0;
    for (const node of root.querySelectorAll<HTMLElement>("li, h3, button")) {
      const range = document.createRange();
      range.selectNodeContents(node);
      widest = Math.max(widest, ...[...range.getClientRects()].map((rect) => rect.width));
    }
    return widest;
  });
  expect(longest).toBeLessThanOrEqual(195);
});

// Spec #376 1.6: on a phone the list of changes starts folded away when it would cover more than 45% of the screen (here a 195 x 640
// screen with a one-row list), and a press on "See what moves" opens it and keeps it open.
test("on a very small phone a short list starts folded, and the person's choice is kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 195, height: 640 });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "One spare underwear + socks" }).uncheck();
  const moves = dialog.getByRole("button", { name: /See what moves/ });
  await expect(moves).toHaveAttribute("aria-expanded", "false");
  await expect(changesList(page)).toBeHidden();
  await moves.click();
  await expect(changesList(page)).toBeVisible();
  await dialog.getByRole("switch", { name: "One spare underwear + socks" }).check();
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await expect(moves).toHaveAttribute("aria-expanded", "true");
});

test("the edit controls wait while a save is on its way", async ({ page }) => {
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await page.route("**/trips/**", async (route) => {
    if (route.request().method() === "POST") await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  const save = dialog.getByRole("button", { name: /^Save \d+ changes?$/ });
  await save.click();
  await expect(dialog.locator("[data-edit-body]")).toHaveAttribute("inert", "");
  await expect(sheet(page)).toHaveCount(0, { timeout: 15_000 });
});
