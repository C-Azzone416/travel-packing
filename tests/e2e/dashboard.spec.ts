import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu, futureTab, openPastAndArchive, planATrip } from "./helpers/menu";
import { planAndCreate } from "./helpers/plan";
import { DEVICE, phoneHomeLayout } from "./helpers/device";

// Home is the laptop suitcase view from 1024px (#387) and the phone suitcase below it (#388); this spec runs on the phone Home
// (the desktop project at 700px, the phone project at its own size).
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
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

/** A card in the Past & archive list. */
const card = (page: Page, name: string) => page.getByRole("article", { name });
/** The phone Home's luggage tag for the next trip. */
const tag = (page: Page, name: string) => page.getByRole("region", { name });
const tab = (page: Page, name: RegExp) => page.getByRole("button", { name });
const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("archive -> appears in Past & archive -> restore -> back in Upcoming", async ({ page }) => {
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Archive");
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();

  await tab(page, /Past & archive/).click();
  const archived = card(page, "San Diego");
  await expect(archived.getByText("Archived trip")).toBeVisible();
  await archived.getByRole("button", { name: "Restore: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await tab(page, /Upcoming/).click();
  await expect(tag(page, "San Diego")).toBeVisible();
});

test("remove -> confirm -> undo leaves the trip identical", async ({ page }) => {
  await openDashboard(page);
  const before = await tag(page, "San Diego").innerText();

  await chooseFromMenu(page, "San Diego", "Remove");
  const dialog = page.getByRole("dialog", { name: "Remove San Diego?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Remove trip" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await page.locator(".toast-region").getByRole("button", { name: "Undo" }).click();
  await expect(tag(page, "San Diego")).toBeVisible();
  expect(await tag(page, "San Diego").innerText()).toBe(before);
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

/** A second upcoming trip, so San Diego stays the next one and London is a Future row. */
async function addLondon(page: Page) {
  await planATrip(page);
  await planAndCreate(page, {
    query: "lon",
    option: /England/,
    start: "2026-11-12",
    end: "2026-11-16",
  });
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
  await futureTab(page).click();
  await expect(page.getByRole("button", { name: "More actions for London" })).toBeVisible();
}

test("a later trip's menu archives it and leaves the next trip alone; Copy trip is there", async ({
  page,
}) => {
  await openDashboard(page);
  await addLondon(page);
  await page.getByRole("button", { name: "More actions for London" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Edit trip",
    "Copy trip",
    "Archive",
    "Remove",
  ]);
  await expect(page.getByRole("menuitem", { name: "Copy trip" })).toHaveAttribute(
    "href",
    /\/trips\/new\?copy=/,
  );
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(futureTab(page)).toContainText("0 trips");
  await expect(tag(page, "San Diego")).toBeVisible();
  await openPastAndArchive(page);
  await expect(card(page, "London")).toBeVisible();
});

test("a later trip's menu removes it after confirming, with the next trip untouched", async ({
  page,
}) => {
  await openDashboard(page);
  await addLondon(page);
  await page.getByRole("button", { name: "More actions for London" }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Remove London?" })
    .getByRole("button", { name: "Remove trip" })
    .click();
  await expect(futureTab(page)).toContainText("0 trips");
  await expect(tag(page, "San Diego")).toBeVisible();
  await page.locator(".toast-region").getByRole("button", { name: "Undo" }).click();
  await expect(futureTab(page)).toContainText("1 trip");
});

test("the tag's menu opens Past & archive, and ?view=archive no longer does", async ({ page }) => {
  await openDashboard(page);
  await openPastAndArchive(page);
  await expect(page.getByRole("heading", { name: "Past trips & archive", level: 1 })).toBeVisible();
  await expect(card(page, "Lisbon")).toBeVisible();
  await page.goto("/?view=archive");
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past trips & archive" })).toHaveCount(0);
});

test("quick view on an archived trip filters without changing progress or touching the network", async ({
  page,
}) => {
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Archive");
  await tab(page, /Past & archive/).click();
  const requests: string[] = [];
  page.on("request", (request) => {
    // Next prefetches linked routes (?_rsc=) as links scroll into view: reads, not saves.
    if (!/\/_next\/|\.(jpg|png|css|js|woff2?)$|_rsc=/.test(request.url()))
      requests.push(`${request.method()} ${request.url()}`);
  });
  const san = card(page, "San Diego");
  const progress = await san.getByText(/of \d+ packed/).innerText();
  await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);

  await san.getByRole("button", { name: /Quick view/ }).click();
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

test(
  "no horizontal scroll at 320px on Home or with a quick view open",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDashboard(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await openPastAndArchive(page);
    await card(page, "Lisbon")
      .getByRole("button", { name: /Quick view/ })
      .click();
    await expect(card(page, "Lisbon").locator('[id^="quick-view-"]')).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  },
);

test("dashboard controls are keyboard operable with 44px targets", DEVICE, async ({ page }) => {
  await openDashboard(page);
  const menuButton = page.getByRole("button", {
    name: "More actions for San Diego",
  });
  for (const control of [menuButton, page.getByRole("tab")]) {
    for (const one of await control.all()) {
      const box = await one.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(43.9);
    }
  }
  // The ⋯ menu is keyboard operable: Enter opens it on the first item (Edit trip), Enter chooses it.
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit trip" })).toBeFocused();
  for (const item of await page.getByRole("menuitem").all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
  await openPastAndArchive(page);
  for (const control of [tab(page, /Upcoming/), tab(page, /Past & archive/)]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
});

test("screenshots of the dashboard", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-dashboard.png`,
    fullPage: true,
  });
  await openPastAndArchive(page);
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
    await openPastAndArchive(page);
    await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = (await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox())!;
    const last = (await page.locator(".deleted-list").boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  },
);

// The phone Home (#388): the luggage tag leads with the next departure; Edit trip opens the route sheet.
test("the tag leads with the next departure; Edit trip opens the route sheet", async ({ page }) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeAttached();
  const hero = tag(page, "San Diego");
  await expect(hero.getByText(/NEXT TRIP · 23–27 Oct · 4 nights/)).toBeVisible();
  await expect(hero).toContainText("7 days");
  await expect(page.getByRole("link", { name: "Continue packing: San Diego" })).toBeVisible();
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

  await chooseFromMenu(page, "San Diego", "Edit trip");
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
});

test("no horizontal scroll at 390 and 1000", async ({ page }) => {
  await openDashboard(page);
  for (const width of [390, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expect(tag(page, "San Diego")).toBeVisible();
  }
});
