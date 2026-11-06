import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";
import { planRouteToList, reviewAndCreate } from "./helpers/plan";

// The laptop Packing view's weather review rows (#385) on the second app, which talks to the fake Open-Meteo. A trip made with
// weather off gets its forecast as suggestions: they are on the card as rows, they do not count until added, Add puts the item
// in its cube, Dismiss hides it for good.
test.use({
  baseURL: `http://localhost:${OPEN_METEO_PORT}`,
  viewport: { width: 1280, height: 900 },
});
const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function tripWithPendingSuggestions(page: Page) {
  await fetch(`${FAKE}/__weather-reset`);
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await planRouteToList(
    page,
    [
      { query: "london", option: /England/ },
      { query: "london", option: /Ontario/ },
    ],
    [inDays(3), inDays(6), inDays(9)],
  );
  await page.getByRole("button", { name: "Not now" }).click();
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  // Weather is off for the trip: the stand-in panel says so. Turning it on brings the forecast and its suggestions.
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("button", { name: /\d+ to review/ })).toBeVisible();
}

const total = async (page: Page) =>
  (await page.getByText(/of \d+ in the bag/).innerText()).replace(/\s+/g, " ");

test("a city with suggestions is outlined; the rows are not counted until added; Add and Dismiss work", async ({
  page,
}) => {
  await tripWithPendingSuggestions(page);
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: /to review/ }) });
  await expect(card).toHaveAttribute("data-city-state", "alert");
  await expect(page.getByText(/\d+ new to review/)).toBeVisible();
  const counted = await total(page);
  const review = card.getByRole("button", { name: /\d+ to review/ });
  // The other stop's card keeps its own height when this one opens its rows (it is not stretched to match).
  const neighbour = page
    .getByRole("article")
    .filter({ hasNot: page.getByRole("button", { name: /to review/ }) });
  const closedHeight = (await neighbour.first().boundingBox())?.height ?? 0;
  expect(closedHeight).toBeGreaterThan(0);
  await review.click();
  await expect(review).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText(/not on your list until you add them/)).toBeVisible();
  expect((await neighbour.first().boundingBox())?.height).toBe(closedHeight);
  // Nothing was counted, and there is no weather cube yet.
  expect(await total(page)).toBe(counted);
  await expect(
    page.getByRole("navigation", { name: "Cubes" }).getByRole("button", { name: /Rain gear/ }),
  ).toHaveCount(0);

  const umbrella = card.getByRole("button", { name: "Add Compact umbrella to Rain gear" });
  await umbrella.click();
  await expect(page.getByRole("status", { name: "Packing updates" })).toHaveText(
    "Compact umbrella added to Rain gear.",
  );
  const rainGear = page
    .getByRole("navigation", { name: "Cubes" })
    .getByRole("button", { name: /Rain gear/ });
  await expect(rainGear).toBeVisible();
  expect(await total(page)).not.toBe(counted);
  await rainGear.click();
  await expect(page.getByRole("checkbox", { name: "Compact umbrella" })).toBeVisible();

  await card.getByRole("button", { name: "Dismiss Rain jacket" }).click();
  await expect(card.getByRole("button", { name: "Dismiss Rain jacket" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Packing updates" })).toHaveText(
    "Rain jacket dismissed.",
  );
  // A dismissed change stays gone after a reload, and was never added.
  await page.reload();
  await page.getByRole("button", { name: /\d+ to review/ }).click();
  await expect(page.getByRole("button", { name: "Dismiss Rain jacket" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Cubes" })
    .getByRole("button", { name: /Rain gear/ })
    .click();
  await expect(page.getByRole("checkbox", { name: "Rain jacket" })).toHaveCount(0);
});
