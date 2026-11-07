import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { expectWholeWords, overflow } from "./helpers/layout";
import { expectPacking } from "./helpers/packing";
import { planATrip } from "./helpers/menu";
import { planAndCreate } from "./helpers/plan";

// The phone Home (#388; spec #376 part 3 section 1.2): the next trip as a luggage tag with four pills (Pack, Weather, Future,
// Stamps), each with its own panel. These run on the phone project at its own size and on the desktop project at the widths
// they set. A fixed clock keeps San Diego the next trip and Lisbon the past one.
// E2E_MUTANT_CSS injects CSS after load so a reviewer can prove each geometry assertion can fail.
const MUTANT_CSS = process.env.E2E_MUTANT_CSS;
const NOW = new Date("2026-10-16T12:00:00");

async function openHome(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
}

const pill = (page: Page, name: RegExp | string) => page.getByRole("tab", { name });

test.describe("pills and panels", DEVICE, () => {
  test("four pills with their counts, Pack open first", async ({ page }) => {
    await openHome(page);
    const tabs = page.getByRole("tablist", { name: "Trip sections" }).getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText(/^Pack \d+\/\d+$/);
    await expect(tabs.nth(1)).toContainText("Weather");
    await expect(tabs.nth(2)).toHaveText("Future 0 trips");
    await expect(tabs.nth(3)).toHaveText(/^Stamps \d+$/);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "home-tab-pack");
    const tag = page.getByRole("region", { name: "San Diego" });
    await expect(tag).toContainText("NEXT TRIP · 23–27 Oct · 4 nights");
    await expect(tag).toContainText("7 days");
  });

  test("Pack shows the count, the cubes and the one primary action", async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole("heading", { name: /in the bag/ })).toHaveText(
      /^\d+ \/ \d+ in the bag$/,
    );
    const cubes = page.getByRole("list", { name: "Cubes" }).getByRole("link");
    expect(await cubes.count()).toBeGreaterThan(2);
    expect(await cubes.first().getAttribute("href")).toMatch(/^\/trips\/[^/]+\?cube=/);
    const go = page.getByRole("link", { name: /^Continue packing: San Diego/ });
    await expect(go).toBeVisible();
    await go.click();
    await expectPacking(page);
  });

  test("each pill opens its own panel, by click and by arrow keys", async ({ page }) => {
    await openHome(page);
    for (const [name, panel] of [
      [/^Weather/, "weather"],
      [/^Future/, "future"],
      [/^Stamps/, "stamps"],
      [/^Pack/, "pack"],
    ] as const) {
      await pill(page, name).click();
      await expect(pill(page, name)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toHaveAttribute(
        "aria-labelledby",
        `home-tab-${panel}`,
      );
    }
    await pill(page, /^Pack/).focus();
    await page.keyboard.press("ArrowRight");
    await expect(pill(page, /^Weather/)).toBeFocused();
    await expect(pill(page, /^Weather/)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(pill(page, /^Stamps/)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(pill(page, /^Pack/)).toHaveAttribute("aria-selected", "true");
  });

  test("Future lists later trips, offers Plan a trip, and ends with the way to the stamps", async ({
    page,
  }) => {
    await openHome(page);
    await pill(page, /^Future/).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("heading", { name: "Future trips" })).toBeVisible();
    await expect(panel.getByText("No other trips planned yet.")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Plan a trip" })).toHaveAttribute(
      "href",
      "/trips/new",
    );
    const past = panel.getByRole("link", { name: "Past trips are with your stamps ›" });
    await expect(past).toHaveAttribute("href", "/?tab=stamps");
    await past.click();
    // Home's own Stamps panel, in the address; the Stamps screen is still in the navigation.
    await expect(pill(page, /^Stamps/)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/\?tab=stamps$/);
    await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeAttached();
  });

  test("at 195 a later trip's mini tag stacks, keeps whole words and keeps its menu off the name", async ({
    page,
  }) => {
    await openHome(page, 390);
    await planATrip(page);
    await planAndCreate(page, {
      query: "lon",
      option: /England/,
      start: "2026-12-17",
      end: "2026-12-20",
    });
    await page.setViewportSize({ width: 195, height: 844 });
    await page.goto("/");
    await pill(page, /^Future/).click();
    const row = page.getByRole("list", { name: "Future trips" }).getByRole("listitem").first();
    await expectWholeWords(row, "the later trip's mini tag at 195");
    const name = (await row
      .locator("span")
      .filter({ hasText: /^London$/ })
      .first()
      .boundingBox())!;
    const menu = (await row.getByRole("button", { name: /^More actions for/ }).boundingBox())!;
    const apart = menu.y + menu.height <= name.y + 0.5 || menu.x + menu.width <= name.x + 0.5;
    expect(apart, "the ⋯ button must not sit over the name").toBe(true);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  for (const width of [195, 390] as const) {
    test(`at ${width} a Future row's open menu stays on screen and above the tag after it`, async ({
      page,
    }) => {
      await openHome(page, 390);
      for (const [query, option, start, end] of [
        ["lon", /England/, "2026-12-17", "2026-12-20"],
        ["paris", /France/, "2027-01-10", "2027-01-13"],
      ] as const) {
        await planATrip(page);
        await planAndCreate(page, { query, option, start, end });
      }
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await pill(page, /^Future/).click();
      await page
        .getByRole("button", { name: /^More actions for / })
        .nth(1)
        .click();
      const panel = page.getByRole("menu").first();
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x, "the open menu must not run off the left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // The point in the middle of each item reaches the menu, not the tag drawn after the row.
      const items = await panel.getByRole("menuitem").all();
      for (const entry of items) {
        const at = (await entry.boundingBox())!;
        const reaches = await page.evaluate(
          ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'),
          [at.x + at.width / 2, at.y + at.height / 2],
        );
        expect(reaches, "a later tag must not paint over the open menu").toBe(true);
      }
    });
  }

  test("the chosen pill is in the address: a link, a reload and Back all land on it", async ({
    page,
  }) => {
    await openHome(page);
    await pill(page, /^Future/).click();
    await expect(page).toHaveURL(/tab=future/);
    await pill(page, /^Stamps/).click();
    await expect(page).toHaveURL(/tab=stamps/);
    await page.goBack();
    await expect(pill(page, /^Future/)).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(pill(page, /^Future/)).toHaveAttribute("aria-selected", "true");
    await page.goto("/?tab=weather");
    await expect(pill(page, /^Weather/)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "home-tab-weather");
  });

  test("the Pack card is the map alone: no route caption under it", async ({ page }) => {
    await openHome(page);
    const card = page.getByRole("figure");
    await expect(card).toHaveAttribute("aria-label", /.+/);
    await expect(card.locator("figcaption")).toHaveCount(0);
  });

  test("Stamps shows the filters, the stickers and the past trips, under the Home's own heading", async ({
    page,
  }) => {
    await openHome(page);
    await pill(page, /^Stamps/).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("group", { name: "Filter stamps" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Past trips" })).toBeVisible();
    await expect(panel.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeAttached();
  });
});

// The 195px band (the hard target of #332) and 320/390, at normal and 200% text: no sideways scroll, every word whole, the
// pills and the primary action inside the screen.
for (const width of [195, 320, 390] as const) {
  for (const zoom of [100, 200] as const) {
    test(
      `${width}px at ${zoom}% text: no sideways scroll, words wrap whole, controls on screen`,
      DEVICE,
      async ({ page }) => {
        await openHome(page, width);
        if (zoom === 200)
          await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        for (const name of [/^Pack/, /^Weather/, /^Future/, /^Stamps/]) {
          await pill(page, name).click();
          expect(await overflow(page), `${name} panel`).toBeLessThanOrEqual(0);
          await expectWholeWords(page.locator("main"), `${name} panel at ${width}px, ${zoom}%`);
          const tabs = await page.getByRole("tab").all();
          for (const tab of tabs) {
            const box = (await tab.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(-0.5);
            expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
          }
        }
        await pill(page, /^Pack/).click();
        const go = page.getByRole("link", { name: /^Continue packing/ });
        await go.scrollIntoViewIfNeeded();
        const box = (await go.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      },
    );
  }
}
