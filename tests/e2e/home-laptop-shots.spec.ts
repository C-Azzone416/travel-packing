import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance, setTripTravelMode } from "./helpers/database";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the laptop Home for design review (#387): the three colour schemes at 1280 and 1024, and Ocean at
// 1023 (the old page) and 390. Run with HOME_SHOTS=<folder>; without it these are skipped. The trips are made through the real
// create flow on the second app (the one wired to the fake Open-Meteo): a two-stop London trip in three days, with the
// forecast turned on from its Packing page, and a later one-stop trip so the Upcoming list has a row.
const SHOTS = process.env.HOME_SHOTS;
const THEMES = ["ocean", "evergreen", "dusk"] as const;
const SIZES = [
  ...THEMES.flatMap((theme) =>
    [1280, 1024].map((width) => ({ theme, width, tag: `${theme}-${width}` })),
  ),
  { theme: "ocean", width: 1023, tag: "ocean-1023" },
  { theme: "ocean", width: 390, tag: "ocean-390" },
] as const;
test.skip(!SHOTS, "set HOME_SHOTS=<folder> to render the design screenshots");
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 1.5 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const { theme, width, tag } of SIZES) {
  test(`${tag}: Home`, async ({ page }) => {
    test.setTimeout(180_000);
    await fetch(`${FAKE}/__weather-reset`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAsOwner(page);
    await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
    await page
      .context()
      .addCookies([
        { name: "appearance", value: theme, url: `http://localhost:${OPEN_METEO_PORT}` },
      ]);
    await page.goto("/");

    await page
      .getByRole("link", { name: /Plan a trip/ })
      .first()
      .click();
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
    // Home may list London as the next trip or as an upcoming row; either way the first link naming it opens its trip.
    await page
      .getByRole("link", { name: /London/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByRole("button", { name: /\d+ to review/ })).toBeVisible();

    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", theme);
    if (width >= 1024) await expect(page.getByText(/^NEXT TRIP/)).toBeVisible();
    else await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await shot(page, `home-${tag}`);
  });
}

// ---- Round 2 (#431 design review): the cells the first set did not show. Run with HOME_SHOTS=<folder> -g "r2" ----
type Stop = { query: string; option: RegExp; leave: number; ret?: number };

async function prepare(page: Page, theme: string) {
  await fetch(`${FAKE}/__weather-reset`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
  await page
    .context()
    .addCookies([{ name: "appearance", value: theme, url: `http://localhost:${OPEN_METEO_PORT}` }]);
  await page.goto("/");
}

/** Plans a trip through the real create flow (weather off, so the forecast arrives as suggestions to review). */
async function plan(page: Page, stops: Stop[]) {
  await page.goto("/");
  await page
    .getByRole("link", { name: /Plan a trip/ })
    .first()
    .click();
  const [first, ...more] = stops;
  await page.getByRole("combobox", { name: "Destination search" }).fill(first.query);
  await page.getByRole("option", { name: first.option }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(first.leave));
  await page.getByLabel("Return", { exact: true }).fill(inDays(first.ret ?? first.leave + 3));
  for (const [index, stop] of more.entries()) {
    await page.getByRole("button", { name: "+ Add another stop" }).click();
    await page
      .getByRole("combobox", { name: `Destination search, Stop ${index + 2}` })
      .fill(stop.query);
    await page.getByRole("option", { name: stop.option }).click();
    await page.getByLabel(`Leave, Stop ${index + 2}`).fill(inDays(stop.leave));
  }
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(first.query, "i") }).first(),
  ).toBeVisible();
}

async function weatherOn(page: Page, name: RegExp) {
  await page.getByRole("link", { name }).first().click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("button", { name: /\d+ to review/ }).first()).toBeVisible();
}

async function home(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByText(/^NEXT TRIP/)).toBeVisible();
  await expect(page.getByText(/Pack for/)).toBeVisible();
}

const LONDON: Stop = { query: "london", option: /England/, leave: 3, ret: 6 };
const SPRINGFIELD: Stop = { query: "springfield", option: /Sangamon/, leave: 20, ret: 23 };
const ONTARIO: Stop = { query: "london", option: /Ontario/, leave: 40, ret: 43 };

for (const [theme, width] of [
  ["ocean", 1280],
  ["ocean", 1024],
  ["evergreen", 1280],
  ["dusk", 1280],
] as const) {
  test(`r2 ${theme}-${width}: upcoming rows and the weather block loaded`, async ({ page }) => {
    test.setTimeout(240_000);
    await prepare(page, theme);
    await plan(page, [LONDON]);
    await plan(page, [SPRINGFIELD]);
    await plan(page, [ONTARIO]);
    await page.goto("/");
    await weatherOn(page, /London/);
    await home(page, width);
    await shot(page, `r2-upcoming-weather-${theme}-${width}`);
  });
}

test("r2 ocean-1280: changes to review, then added (tile alert, city header)", async ({ page }) => {
  test.setTimeout(240_000);
  await prepare(page, "ocean");
  await plan(page, [LONDON, { query: "springfield", option: /Sangamon/, leave: 9 }]);
  await weatherOn(page, /London/);
  await home(page, 1280);
  await shot(page, "r2-to-review-ocean-1280");
  await page
    .getByRole("link", { name: /Continue packing|Start packing/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /\d+ to review/ })
    .first()
    .click();
  await page.locator("[data-suggestion-add]").first().click();
  await home(page, 1280);
  await shot(page, "r2-added-ocean-1280");
});

test("r2 ocean-1280: a two-city flight trip", async ({ page }) => {
  test.setTimeout(240_000);
  await prepare(page, "ocean");
  await plan(page, [LONDON, { query: "springfield", option: /Sangamon/, leave: 9 }]);
  await setTripTravelMode(`e2e-${ownerEmailFor(test.info().project.name)}`, "London", "fly");
  await weatherOn(page, /London/);
  await home(page, 1280);
  await shot(page, "r2-twocity-flight-ocean-1280");
});
