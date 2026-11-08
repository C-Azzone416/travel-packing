import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance, setOwnerHomeCity } from "./helpers/database";
import { chooseMode, nextButton, pickPlace, setRouteDates } from "./helpers/plan";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of Plan a trip for design review (#390): every step at laptop (1280) and phone (390) in Ocean, the
// Review step in Evergreen and Dusk, and the Starting list at 195. Run with PLAN_SHOTS=<folder>; without it these are skipped.
// The trip is made on the second app, which talks to the fake geocoder (places with coordinates, so the map draws) and the
// fake Open-Meteo (so weather rows appear).
const SHOTS = process.env.PLAN_SHOTS;
test.skip(!SHOTS, "set PLAN_SHOTS=<folder> to render the design screenshots");
// The home city is the account's, not the test's: put it back so no other spec plans a trip from a place it cannot resolve.
test.afterEach(async () => {
  await setOwnerHomeCity(`e2e-${ownerEmailFor(test.info().project.name)}`, null);
});
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 1.5 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const HOME = {
  id: "open-meteo-5809844",
  city: "Seattle",
  region: "Washington",
  country: "United States",
  countryCode: "US",
  label: "Seattle, Washington, United States",
  provider: "open-meteo",
  providerPlaceId: "5809844",
  latitude: 47.61,
  longitude: -122.33,
};

async function shot(page: Page, name: string, viewportOnly = false) {
  mkdirSync(SHOTS!, { recursive: true });
  // The map is drawn on the server a moment after the route changes: take the picture once it is there.
  // A map that never settles is a finding, not something to photograph around: this waits and fails if it does not come.
  const map = page.locator("[data-plan-map]").first();
  if ((await map.count()) > 0)
    await expect(page.locator("[data-map-ready]").first()).toBeVisible({ timeout: 20_000 });
  if (!viewportOnly) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !viewportOnly });
}

async function open(page: Page, theme: string, width: number, height: number) {
  await fetch(`${FAKE}/__weather-reset`);
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  const owner = `e2e-${ownerEmailFor(test.info().project.name)}`;
  await setOwnerAppearance(owner, theme);
  await setOwnerHomeCity(owner, HOME);
  await page
    .context()
    .addCookies([{ name: "appearance", value: theme, url: `http://localhost:${OPEN_METEO_PORT}` }]);
  await page.goto("/trips/new");
  await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
}

interface Route {
  stops: { query: string; option: RegExp }[];
  /** First arrival, then each stop's Leave date. */
  dates: string[];
}
const TWO_LONDONS: Route = {
  stops: [
    { query: "london", option: /England/ },
    { query: "london", option: /Ontario/ },
  ],
  dates: [inDays(3), inDays(6), inDays(9)],
};
const LISBON_PORTO: Route = {
  stops: [
    { query: "lisbon", option: /Portugal/ },
    { query: "porto", option: /Portugal/ },
  ],
  dates: [inDays(3), inDays(6), inDays(10)],
};

/** Walks the plan, taking a picture of each step as it is open. `only` limits which are taken. */
async function walk(page: Page, prefix: string, only?: string[], route: Route = TWO_LONDONS) {
  const take = async (step: string, viewportOnly = false) => {
    if (!only || only.includes(step)) await shot(page, `${prefix}-${step}`, viewportOnly);
  };
  await pickPlace(page, route.stops[0].query, route.stops[0].option);
  for (let at = 1; at < route.stops.length; at += 1) {
    await page.getByRole("button", { name: "Add a stop" }).click();
    await pickPlace(
      page,
      route.stops[at].query,
      route.stops[at].option,
      `Destination search, Stop ${at + 1}`,
    );
  }
  await take("1-where");
  await nextButton(page).click();
  await setRouteDates(page, route.dates);
  await take("2-when");
  await nextButton(page).click();
  // The Where step again, now that the dates are done: each stop row shows its dates.
  if (!only || only.includes("1b-where-dated")) {
    await page.getByRole("button", { name: "Edit Where" }).click();
    await take("1b-where-dated");
    await nextButton(page).click();
  }
  await chooseMode(page, "Fly");
  await take("3-how");
  await nextButton(page).click();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByRole("checkbox", { name: /Weather suggestions/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /I’ll have laundry/ }).check();
  await take("4-list");
  await nextButton(page).click();
  await page.getByLabel("Name this trip").fill("Two Londons");
  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
  await take("5-review");
  if (!only || only.includes("5-review-viewport")) {
    // What the phone shows on screen (not the full page): the top, and scrolled to the bottom with the pinned bar in place.
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `${prefix}-5-review-top`, true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await shot(page, `${prefix}-5-review-bottom`, true);
  }
}

test("ocean 1280: When, Starting list and Review (map settled)", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "ocean", 1280, 900);
  await walk(page, "pl-l-ocean-1280", ["2-when", "4-list", "5-review"]);
});

test("ocean 390: Starting list and Review, on screen", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "ocean", 390, 844);
  await walk(page, "pl-p-ocean-390", ["4-list", "5-review", "5-review-viewport"]);
});

test("ocean 195: steps 1, 2, 4 and 5", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "ocean", 195, 700);
  await walk(page, "pl-p-ocean-195", ["1-where", "2-when", "4-list", "5-review"]);
});

test("ocean 1280, Lisbon to Porto: Where with dates, and the Starting list", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "ocean", 1280, 900);
  await walk(
    page,
    "pl-l-ocean-1280-lisbon-porto",
    ["1b-where-dated", "4-list", "5-review"],
    LISBON_PORTO,
  );
});
