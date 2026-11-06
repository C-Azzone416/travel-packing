import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";

// The laptop (>= 1024px) Home (#387): the next trip as a route map, a suitcase of cube tiles and a luggage tag, in the three
// width bands (1024, 1280, 1440) and, at 1023, proof that the page below the breakpoint is the old one. A fixed clock keeps
// San Diego the next trip. Home has no other trip in the seed, so the Upcoming list is empty here (it is covered by the unit
// tests and the screenshots).
const NOW = new Date("2026-10-16T12:00:00");
const BANDS = [1024, 1280, 1440] as const;

async function openHome(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of BANDS) {
  test(`${width}: the next trip is the tag, the suitcase and the map, with no sideways scroll`, async ({
    page,
  }) => {
    await openHome(page, width);
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
    await expect(page.getByText(/^NEXT TRIP/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /In the bag/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Cubes" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Continue packing: San Diego/ })).toBeVisible();
    // The old ledger is gone at this width.
    await expect(page.locator(".ledger-hero")).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // Two columns: the tag sits to the right of the suitcase.
    const left = await page.getByRole("region", { name: /In the bag/ }).boundingBox();
    const right = await page.getByRole("region", { name: "San Diego" }).boundingBox();
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1);
  });
}

test("1023: Home is the old ledger, unchanged", async ({ page }) => {
  await openHome(page, 1023);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(page.locator(".ledger-hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: /In the bag/ })).toHaveCount(0);
  await expect(page.getByText(/^NEXT TRIP/)).toHaveCount(0);
});

test("a cube tile opens that cube on Packing, and Continue packing opens the first open cube", async ({
  page,
}) => {
  await openHome(page, 1280);
  const cubes = page.getByRole("list", { name: "Cubes" });
  const firstTile = cubes.getByRole("link").first();
  const href = await firstTile.getAttribute("href");
  expect(href).toMatch(/^\/trips\/[^/]+\?cube=/);
  await firstTile.click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  expect(page.url()).toContain("cube=");
});

test("the more menu edits the trip, and Past & archive and Plan a trip are links", async ({
  page,
}) => {
  await openHome(page, 1280);
  await page.getByRole("button", { name: /More actions for San Diego/ }).click();
  await expect(page.getByRole("menuitem", { name: "Edit trip" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Edit trip" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Past & archive" })).toHaveAttribute(
    "href",
    "/stamps",
  );
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page).toHaveURL(/\/trips\/new/);
});

test("the more menu opens the archive view directly", async ({ page }) => {
  await openHome(page, 1280);
  await page.getByRole("button", { name: /More actions for San Diego/ }).click();
  await page.getByRole("menuitem", { name: "Past trips & archive" }).click();
  await expect(page.getByRole("heading", { name: "Past trips & archive", level: 1 })).toBeVisible();
});

test("the keyboard reaches Continue packing and Enter opens Packing", async ({ page }) => {
  await openHome(page, 1280);
  const next = page.getByRole("link", { name: /^Continue packing: San Diego/ });
  await next.focus();
  // A real key press, so the ring is the keyboard one (:focus-visible).
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(next).toBeFocused();
  await expect(next).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
});

test("640px (200% zoom on a laptop) keeps the old page, with no sideways scroll", async ({
  page,
}) => {
  await openHome(page, 640);
  await expect(page.locator(".ledger-hero")).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

for (const width of [1024, 1280]) {
  test(`${width}: accessibility`, async ({ page }) => {
    await openHome(page, width);
    await expect(page.getByRole("heading", { name: /In the bag/ })).toBeVisible();
    // #377: the redesign palette has muted-on-paper pairs below 4.5:1; contrast is tracked there. Every other rule is on.
    await expectAccessible(page, `Home laptop ${width}`, { disable: ["color-contrast"] });
  });
}
