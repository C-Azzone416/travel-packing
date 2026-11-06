import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

const NOW = new Date("2026-10-16T12:00:00");

async function openStamps(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.goto("/stamps");
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past trips", level: 2 })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const overflowingElements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${element.className}`,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        };
      })
      .filter(({ left, right }) => left < 0 || right > document.documentElement.clientWidth)
      .slice(0, 12),
  );

test("the sticker suitcase is data-backed and selects trips without changing them", async ({
  page,
}) => {
  await openStamps(page);
  await expect(page.getByText("1 inked")).toBeVisible();
  const lisbon = page.getByRole("button", { name: /Lisbon, Sep 2026, 1 trip/ });
  const sanDiego = page.getByRole("button", { name: /San Diego, Oct 2026, 1 trip/ });
  await expect(lisbon).toHaveAttribute("aria-pressed", "true");
  await expect(sanDiego).toHaveAttribute("data-upcoming", "true");
  await expect(page.getByLabel("Travel totals").getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Selected trip: Lisbon" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reuse this list" })).toHaveAttribute(
    "href",
    /\/trips\/new\?copy=/,
  );
  await sanDiego.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article", { name: "Selected trip: San Diego" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open trip" })).toHaveAttribute("href", /\/trips\//);
  await page.reload();
  await expect(page.getByText("1 inked")).toBeVisible();
});

test("the filters update the archive, keyboard state and accessible name", async ({ page }) => {
  await openStamps(page);
  const year = page.getByRole("button", { name: "2026", exact: true });
  await year.focus();
  await page.keyboard.press("Enter");
  await expect(year).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Stickers · 2026")).toBeVisible();
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page.getByText("Stickers · All time")).toBeVisible();
  // #377 tracks the accepted palette's known contrast exceptions; every other WCAG check remains enabled.
  await expectAccessible(page, "Stamps suitcase", { disable: ["color-contrast"] });
});

test(
  "phone and 195px stress widths keep every action reachable with no page overflow",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 195, height: 640 });
    await openStamps(page);
    expect(await sideways(page), JSON.stringify(await overflowingElements(page), null, 2)).toBe(0);
    await expect(page.getByRole("button", { name: "Last 12 months" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Lisbon, Sep 2026, 1 trip/ })).toBeVisible();
    await page.getByRole("heading", { name: "Past trips" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Reuse this list" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open trip" })).toBeVisible();
    expect(await sideways(page), JSON.stringify(await overflowingElements(page), null, 2)).toBe(0);
  },
);

test("focused review screenshots", DEVICE, async ({ page }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await openStamps(page);
  await page.evaluate(
    (scheme) => document.documentElement.setAttribute("data-scheme", scheme),
    phone ? "evergreen" : "ocean",
  );
  await page.screenshot({
    path: `test-results/screenshots/stamps-${phone ? "evergreen-390" : "ocean-1280"}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 195, height: 640 });
  await page.evaluate(() => document.documentElement.setAttribute("data-scheme", "dusk"));
  await page.screenshot({
    path: `test-results/screenshots/stamps-dusk-195-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
