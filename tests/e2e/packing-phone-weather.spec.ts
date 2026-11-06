import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// The phone Packing view's forecast (#386) on the second app, which talks to the fake Open-Meteo: ONE city at a time with a
// toggle, a dot on the city that has changes, "N to review" opening Add and Dismiss rows. Like the laptop, a trip made with
// weather off gets its forecast as suggestions to review.
test.use({
  baseURL: `http://localhost:${OPEN_METEO_PORT}`,
  viewport: { width: 390, height: 844 },
});
const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function tripWithPendingSuggestions(page: Page) {
  await fetch(`${FAKE}/__weather-reset`);
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(3));
  await page.getByLabel("Return", { exact: true }).fill(inDays(6));
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await page.getByRole("combobox", { name: "Destination search, Stop 2" }).fill("london");
  await page.getByRole("option", { name: /Ontario/ }).click();
  await page.getByLabel("Leave, Stop 2").fill(inDays(9));
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  // Weather is off for the trip: the stand-in panel says so. Turning it on brings the forecast and its suggestions.
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("button", { name: /\d+ to review/ })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const total = async (page: Page) =>
  (await page.getByText(/of \d+ in the bag/).innerText()).replace(/\s+/g, " ");

test(
  "one city at a time: the toggle has a dot on the city with changes, and the other city has none",
  DEVICE,
  async ({ page }) => {
    await tripWithPendingSuggestions(page);
    const tabs = page.getByRole("tablist", { name: "City" });
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    const withChanges = tabs.getByRole("tab", { name: /has changes to review/ });
    await expect(withChanges).toHaveCount(1);
    await expect(withChanges).toHaveAttribute("aria-selected", "true");
    const card = page.getByRole("region", { name: "Forecast" });
    await expect(card).toHaveAttribute("data-forecast-state", "alert");
    // Only the open city's tiles are on screen; the other city is one tap away.
    await expect(card.getByRole("list", { name: /^Daily forecast for/ })).toHaveCount(1);
    const other = tabs.getByRole("tab").nth(1);
    await other.click();
    await expect(other).toHaveAttribute("aria-selected", "true");
    await expect(card.getByRole("list", { name: /^Daily forecast for/ })).toHaveCount(1);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  },
);

test("the city toggle is keyboard operable with the arrow keys", async ({ page }) => {
  await tripWithPendingSuggestions(page);
  const [first, second] = await page.getByRole("tablist", { name: "City" }).getByRole("tab").all();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(second).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(second).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
});

test(
  "N to review opens Add and Dismiss; the rows are not counted until added; Add and Dismiss work",
  DEVICE,
  async ({ page }) => {
    await tripWithPendingSuggestions(page);
    const counted = await total(page);
    const review = page.getByRole("button", { name: /\d+ to review/ });
    await expect(review).toHaveAttribute("aria-expanded", "false");
    await review.click();
    await expect(review).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/^New: /)).toBeVisible();
    const suitcase = (await page.locator("[data-cube]").boundingBox())!;
    const actions = (await page.getByRole("button", { name: /^All in/ }).boundingBox())!;
    expect(suitcase.y, "the expanded review keeps the suitcase above the actions").toBeLessThan(
      actions.y,
    );
    expect(
      Math.min(suitcase.y + suitcase.height, actions.y) - suitcase.y,
      "at least two suitcase rows remain on-screen",
    ).toBeGreaterThanOrEqual(100);
    // Nothing was counted, and there is no weather cube yet.
    expect(await total(page)).toBe(counted);
    const cubes = page.getByRole("navigation", { name: "Cubes" });
    await expect(cubes.getByRole("button", { name: /Rain gear/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Add Compact umbrella to Rain gear" }).click();
    await expect(page.getByRole("status", { name: "Packing updates" })).toHaveText(
      "Compact umbrella added to Rain gear.",
    );
    const rainGear = cubes.getByRole("button", { name: /Rain gear/ });
    await expect(rainGear).toBeVisible();
    expect(await total(page)).not.toBe(counted);
    await rainGear.click();
    await expect(page.getByRole("checkbox", { name: "Compact umbrella" })).toBeVisible();

    await page.getByRole("button", { name: "Dismiss Rain jacket" }).click();
    await expect(page.getByRole("status", { name: "Packing updates" })).toHaveText(
      "Rain jacket dismissed.",
    );
    // A dismissed change stays gone after a reload, and was never added.
    await page.reload();
    await page.getByRole("button", { name: /\d+ to review/ }).click();
    await expect(page.getByRole("button", { name: "Dismiss Rain jacket" })).toHaveCount(0);
  },
);

test(
  "the forecast with its review rows is accessible and fits 320px and 195px",
  DEVICE,
  async ({ page }) => {
    await tripWithPendingSuggestions(page);
    await page.getByRole("button", { name: /\d+ to review/ }).click();
    await expectAccessible(page, "forecast with review rows", { disable: ["color-contrast"] });
    for (const width of [320, 195]) {
      await page.setViewportSize({ width, height: 640 });
      expect(await sideways(page), `${width}px`).toBeLessThanOrEqual(0);
      const add = page.getByRole("button", { name: /^Add / }).first();
      await add.scrollIntoViewIfNeeded();
      const box = (await add.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
  },
);
