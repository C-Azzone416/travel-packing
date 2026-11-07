import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import { expectPacking, openCube } from "./helpers/packing";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

// A fixed clock keeps the seeded sample trips stable: San Diego upcoming, Lisbon past. (Trip ids are the real
// database's uuids, so tests find a trip's panels by role/name or `aria-controls`, never by a fixture id.)
const NOW = new Date("2026-10-16T12:00:00");

// Every route needs the owner's session, so each test signs in first. `signedIn` is true for a page
// opened in a context that already has the session cookie.
async function openDashboard(page: Page, { signedIn = false } = {}) {
  await page.clock.setFixedTime(NOW);
  if (signedIn) await page.goto("/");
  else await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });
const tab = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("archive -> appears in Past & archive -> restore -> back in Upcoming", async ({ page }) => {
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Archive");
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await expect(page.getByText("No upcoming trips.")).toBeVisible();

  await tab(page, /Past & archive/).click();
  const archived = card(page, "San Diego");
  await expect(archived.getByText("Archived trip")).toBeVisible();
  await archived.getByRole("button", { name: "Restore: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await tab(page, /Upcoming/).click();
  await expect(card(page, "San Diego")).toBeVisible();
});

test("remove -> confirm -> undo leaves the trip identical", async ({ page }) => {
  await openDashboard(page);
  const before = await card(page, "San Diego").innerText();

  await chooseFromMenu(page, "San Diego", "Remove");
  const dialog = page.getByRole("dialog", { name: "Remove San Diego?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Remove trip" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await page.locator(".toast-region").getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "San Diego")).toBeVisible();
  expect(await card(page, "San Diego").innerText()).toBe(before);
});

test("Recently deleted offers Undo remove, with no retention period shown", async ({ page }) => {
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Remove");
  await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
  await tab(page, /Past & archive/).click();
  await expect(page.getByText(/30 days|retention/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo remove: San Diego" }).click();
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
});

test("quick view filters without changing progress or touching the network", async ({ page }) => {
  await openDashboard(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    // Next prefetches linked routes (?_rsc=) as links scroll into view: reads, not saves.
    if (!/\/_next\/|\.(jpg|png|css|js|woff2?)$|_rsc=/.test(request.url()))
      requests.push(`${request.method()} ${request.url()}`);
  });
  const san = card(page, "San Diego");
  const progress = await san.getByText(/of \d+ packed/).innerText();
  await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);

  await chooseFromMenu(page, "San Diego", "Quick view");
  const quick = san.locator('[id^="quick-view-"]');
  await expect(quick.getByRole("button", { name: "Still to pack" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(quick.getByText("Sleepwear")).toHaveCount(0);
  await quick.getByRole("button", { name: "All" }).click();
  await expect(quick.getByText("Sleepwear")).toBeVisible();
  await quick.getByRole("button", { name: "Still to pack" }).click();

  expect(await san.getByText(/of \d+ packed/).innerText()).toBe(progress);
  await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("no horizontal scroll at 320px with a quick view open", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Quick view");
  await expect(card(page, "San Diego").locator('[id^="quick-view-"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await tab(page, /Past & archive/).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("dashboard controls are keyboard operable with 44px targets", DEVICE, async ({ page }) => {
  await openDashboard(page);
  for (const control of [
    tab(page, /Upcoming/),
    tab(page, /Past & archive/),
    card(page, "San Diego").getByRole("button", { name: "More actions for San Diego" }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.9);
  }
  // The ⋯ menu is keyboard operable: Enter opens it on the first item (Quick view), Enter chooses it.
  await card(page, "San Diego").getByRole("button", { name: "More actions for San Diego" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Quick view" })).toBeFocused();
  for (const item of await page.getByRole("menuitem").all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
  await page.keyboard.press("Enter");
  const quick = card(page, "San Diego").locator('[id^="quick-view-"]');
  await expect(quick).toBeVisible();
  for (const control of await quick.getByRole("button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
});

test("screenshots of the dashboard", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Quick view");
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-dashboard.png`,
    fullPage: true,
  });
  await tab(page, /Past & archive/).click();
  await expect(card(page, "Lisbon")).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-dashboard-archive.png`,
    fullPage: true,
  });
});

test(
  "on phones the end of the page is never hidden behind the nav",
  DEVICE,
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "the bottom nav is a phone layout");
    await openDashboard(page);
    await tab(page, /Past & archive/).click();
    await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = (await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox())!;
    const last = (await page.locator(".deleted-list").boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  },
);

// Field Ledger dashboard (#143): the hero, its actions and the dark header.
test("the hero leads with the next departure; Edit trip opens the route sheet", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "Your travel ledger", level: 1 })).toBeVisible();
  const hero = card(page, "San Diego");
  await expect(hero.getByText("Next departure · Oct 23")).toBeVisible();
  await expect(hero.getByText("days to go")).toBeVisible();
  await expect(hero.getByRole("img", { name: /departure stamp$|route stamps$/ })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Continue packing: San Diego" })).toBeVisible();
  // The header is the laptop bar from 1024px (the Home below it is this page, so go up for the bar).
  await page.setViewportSize({ width: 1280, height: 900 });
  // The header bar is the paper palette token (the laptop bar; on a phone the header sits on the page colour), not a hard-coded colour.
  const headerBackground = await page
    .locator("header.topbar .topbar-inner")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const headerToken = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--paper)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(headerBackground).toBe(headerToken);
  await page.setViewportSize({ width: 1000, height: 900 });

  await hero.getByRole("button", { name: "Edit trip: San Diego" }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
});

test("no horizontal scroll at 390 and 1000, and the sidebar sits beside the hero only on wide screens", async ({
  page,
}) => {
  await openDashboard(page);
  for (const [width, beside] of [
    [390, false],
    [1000, true],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const hero = await page.getByRole("article", { name: "San Diego" }).boundingBox();
    const later = await page.getByRole("complementary", { name: "Later journeys" }).boundingBox();
    expect(later!.x > hero!.x + hero!.width - 1).toBe(beside);
  }
});

// Generic add-item (#147): the hero's inline "＋ Add item".
test("the hero's ＋ Add item adds an item inline, never doubles it, and hands Bathroom to its form", async ({
  page,
}) => {
  await openDashboard(page);
  const hero = card(page, "San Diego");
  const toggle = hero.getByRole("button", { name: "＋ Add item" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(hero.getByRole("textbox")).toHaveCount(0);
  const progress = () => hero.getByText(/of \d+ packed/).innerText();
  const before = await progress();

  await toggle.click();
  for (const control of [
    hero.getByRole("textbox", { name: "Item name" }),
    hero.getByRole("combobox", { name: "Category" }),
    hero.getByRole("spinbutton", { name: "Needed" }),
    hero.getByRole("button", { name: "Add to list" }),
  ]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
  await hero.getByRole("textbox", { name: "Item name" }).fill("Camera");
  await hero.getByRole("combobox", { name: "Category" }).selectOption("Tech");
  await hero.getByRole("spinbutton", { name: "Needed" }).fill("2");
  await hero.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText("Camera added to Tech")).toBeVisible();
  await expect(hero.getByRole("textbox")).toHaveCount(0);
  expect(await progress()).not.toBe(before);

  // It is stored: it is on the trip screen, once, after a reload.
  await page.reload();
  await hero.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  await openCube(page, "Tech");
  await expect(page.locator("[data-item-id]").filter({ hasText: "Camera" })).toHaveCount(1);
  await page.goto("/");

  // The same item again is not added: the form says so and Edit quantity opens that item's editor on the trip screen.
  const editQuantity = async (needed: number) => {
    await toggle.click();
    await hero.getByRole("textbox", { name: "Item name" }).fill(" camera ");
    await hero.getByRole("combobox", { name: "Category" }).selectOption("Tech");
    await hero.getByRole("button", { name: "Add to list" }).click();
    await expect(
      hero.getByText(new RegExp(`Camera is already on your list \\(needed: ${needed}\\)`)),
    ).toBeVisible();
    await hero.getByRole("button", { name: "Edit quantity" }).click();
    await expectPacking(page);
  };
  const editor = page.getByRole("dialog", { name: "Edit item" });
  // The item's cube opens with its editor; closing it puts focus on the item's own tick.
  const camera = page.locator("[data-item-id]").filter({ hasText: "Camera" }).getByRole("checkbox");

  await editQuantity(2);
  // It opens that item's own editor, and the URL is the plain trip again.
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Item name")).toHaveValue("Camera");
  await expect(page).toHaveURL(/\/trips\/[^?]+$/);
  // Saving puts focus on that item's row once the updated row is on screen: there is no button that opened the editor,
  // and the row re-renders after the write finishes.
  await editor.getByRole("spinbutton", { name: "Quantity" }).fill("3");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(editor).toHaveCount(0);
  await expect(camera).toHaveAttribute("aria-label", "Camera, 3");
  await expect(camera).not.toBeChecked();
  await expect(camera).toBeFocused();
  await page.goto("/");

  // Closing without saving (Escape) lands there too.
  await editQuantity(3);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(camera).toBeFocused();
  await page.goto("/");

  // Bathroom hands off to the Bathroom form, filled in, right on the dashboard.
  await toggle.click();
  await hero.getByRole("textbox", { name: "Item name" }).fill("Floss");
  await hero.getByRole("combobox", { name: "Category" }).selectOption("Bathroom");
  await hero.getByRole("button", { name: "Continue to Bathroom item" }).click();
  const bathroom = page.getByRole("dialog", { name: "Add a Bathroom item" });
  await expect(bathroom.getByLabel("Item name")).toHaveValue("Floss");
  await bathroom.getByRole("button", { name: "Add toiletry item" }).click();
  await expect(page.getByText("Floss added to Bathroom")).toBeVisible();
});

test("the hero's ＋ Add item is keyboard operable and fits a phone", DEVICE, async ({ page }) => {
  await openDashboard(page);
  const hero = card(page, "San Diego");
  await hero.getByRole("button", { name: "＋ Add item" }).focus();
  await page.keyboard.press("Enter");
  await expect(hero.getByRole("textbox", { name: "Item name" })).toBeFocused();
  await page.keyboard.type("Charger cable");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Charger cable added to Clothing")).toBeVisible();
  await hero.getByRole("button", { name: "＋ Add item" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
