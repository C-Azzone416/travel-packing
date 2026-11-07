import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE, legacyPackingLayout } from "./helpers/device";

// Edit trip (#203, #389): the route and dates and the packing preferences in one sheet, with a live "What changes in your list"
// panel beside the edits. Real app, real database. The merge rules themselves are unit-tested (item-ops, recalc-preview,
// edit-diff); these tests prove the sheet shows them truthfully and that the stored list keeps the person's work.
const NOW = new Date("2026-10-16T12:00:00");

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
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
  await legacyPackingLayout(page);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  const hero = page.getByRole("article", { name: "San Diego" });
  await hero.getByRole("button", { name: "Edit trip: San Diego" }).click();
  await expect(section(page, "Route & dates")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
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
  await legacyPackingLayout(page);
  await openSanDiego(page);
  // The person's work: a manual item, an edited suggestion, packed progress, and a removed optional suggestion.
  await page.getByRole("button", { name: "＋ Add item" }).click();
  await page.getByRole("textbox", { name: "Item name" }).fill("Camera");
  await page.getByRole("combobox", { name: "Category" }).selectOption("Tech");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(row(page, "tops")).toBeVisible();
  await row(page, "sleepwear").locator(".item-body").click();
  const editor = page.getByRole("dialog", { name: "Edit item" });
  await editor.getByLabel("Item name").fill("Pajamas");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sleepwear")).toContainText("Pajamas");
  const underwearBefore = (await row(page, "underwear").innerText()).match(
    /(\d+) of (\d+) packed/,
  )!;
  await row(page, "underwear").getByRole("button", { name: "Increase packed Underwear" }).click();
  const underwearNow = `${Number(underwearBefore[1]) + 1} of ${underwearBefore[2]} packed`;
  await expect(row(page, "underwear")).toContainText(underwearNow);
  await row(page, "nice-shoes").locator(".item-body").click();
  await page.getByRole("button", { name: "Remove item" }).click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: /Remove/ })
    .last()
    .click();
  await expect(row(page, "nice-shoes")).toHaveCount(0);

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
  await expect(row(page, "tops")).toContainText("of 4 packed");
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".toast-region")).toContainText("Preferences updated.");

  // After a reload, from the database: the untouched suggestion followed the new preference; the person's work is intact.
  await page.reload();
  await expect(row(page, "tops")).toContainText("of 2 packed");
  await expect(row(page, "sleepwear")).toContainText("Pajamas");
  await expect(row(page, "underwear")).toContainText(underwearNow);
  await expect(page.getByText("Camera", { exact: true })).toHaveCount(1);
  await expect(row(page, "nice-shoes")).toHaveCount(0);
});

test("a packed count above the new target is shown, needs an acknowledgement, and is lowered to the target", async ({
  page,
}) => {
  await legacyPackingLayout(page);
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Pack all Everyday tops" }).click();
  await expect(row(page, "tops")).toContainText("4 of 4 packed");
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await expect(dialog.getByText("Packed 4 → 2")).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I understand/ }).check();
  await save(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page, "tops")).toContainText("2 of 2 packed");
});

test("Undo all, Cancel and Escape leave the trip unchanged, and ask nothing: nothing was saved", async ({
  page,
}) => {
  await legacyPackingLayout(page);
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
  await expect(row(page, "tops")).toContainText("of 4 packed");
  const last = await openPreferences(page);
  await expect(last.getByRole("switch", { name: "Laundry on this trip" })).not.toBeChecked();
});

test("a list the trip has moved on from is refused: you are told, selections kept, and Save again works", async ({
  page,
  context,
}) => {
  await legacyPackingLayout(page);
  await openSanDiego(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  // Another tab (the same signed-in person) packs something while this sheet is open.
  const other = await context.newPage();
  await legacyPackingLayout(other);
  await other.clock.setFixedTime(NOW);
  await other.goto(page.url());
  const socks = other.locator('[data-item-id="socks"]');
  const socksBefore = (await socks.innerText()).match(/(\d+) of (\d+) packed/)!;
  const socksNow = `${Number(socksBefore[1]) + 1} of ${socksBefore[2]} packed`;
  // A stepper tap is sent after a short pause: wait for the write that carries it, then a reload shows it stored.
  const written = other.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes("socks"),
  );
  await socks.getByRole("button", { name: "Increase packed Socks" }).click();
  await expect(socks).toContainText(socksNow);
  await written;
  await other.reload();
  await expect(other.locator('[data-item-id="socks"]')).toContainText(socksNow);
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
  await legacyPackingLayout(page);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
  const dialog = await openPreferences(page);
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).uncheck();
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
  await legacyPackingLayout(page);
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
  await legacyPackingLayout(page);
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
  await legacyPackingLayout(page);
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
    await legacyPackingLayout(page);
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
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
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
  expect(scrolls.every((extra) => extra <= 0)).toBe(true);
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
