import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";

// The laptop (>= 1024px) Home (#387): the next trip as a route map, a suitcase of cube tiles and a luggage tag, in the three
// width bands (1024, 1280, 1440) and, at 1023, proof that the page below the breakpoint is the phone Home (#388). A fixed clock keeps
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
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // Two columns: the tag sits to the right of the suitcase.
    const left = await page.getByRole("region", { name: /In the bag/ }).boundingBox();
    const right = await page.getByRole("region", { name: "San Diego" }).boundingBox();
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1);
  });
}

test("1023: Home is the phone Home (the four pills), not the laptop suitcase", async ({ page }) => {
  await openHome(page, 1023);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^In the bag/ })).toHaveCount(0);
  await expect(page.getByText(/^NEXT TRIP · \d/)).toBeVisible();
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

test("640px (200% zoom on a laptop) is the phone Home, with no sideways scroll", async ({
  page,
}) => {
  await openHome(page, 640);
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
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

// Design round 2 (#431): at the narrow end of the laptop range the tiles are about 140px wide. A name never breaks inside a
// word (it had read "Clothin" / "g"), and the Upcoming heading row keeps Plan a trip beside the heading.
for (const width of [1024, 1100]) {
  test(`${width}: a cube name stays whole on one line, and Plan a trip shares the Upcoming heading's row`, async ({
    page,
  }) => {
    await openHome(page, width);
    const names = await page.getByRole("list", { name: "Cubes" }).evaluate((list) =>
      [...list.querySelectorAll<HTMLElement>("li > * > span:first-child")].map((node) => {
        const style = getComputedStyle(node);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        return {
          text: node.textContent,
          lines: Math.round(node.getBoundingClientRect().height / line),
          clipped: node.scrollWidth > node.clientWidth + 1,
        };
      }),
    );
    expect(names.length).toBeGreaterThan(2);
    for (const name of names) {
      expect(name.lines, `${name.text} is one line`).toBe(1);
      expect(name.clipped, `${name.text} is not cut off`).toBe(false);
    }
    const heading = await page.getByRole("heading", { name: "Upcoming trips" }).boundingBox();
    const plan = await page.getByRole("link", { name: /Plan a trip/ }).boundingBox();
    expect(plan!.y, "Plan a trip is on the heading's row").toBeLessThan(
      heading!.y + heading!.height,
    );
  });
}

test("the trip menu's Archive moves the trip out of Upcoming and into Past & archive", async ({
  page,
}) => {
  await openHome(page, 1280);
  await page.getByRole("button", { name: /More actions for San Diego/ }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  // It is still there in the archive (the list's own tab is on screen once there is no next trip).
  await page.getByRole("button", { name: /^Past & archive/ }).click();
  await expect(page.getByRole("article", { name: "San Diego" })).toBeVisible();
});
