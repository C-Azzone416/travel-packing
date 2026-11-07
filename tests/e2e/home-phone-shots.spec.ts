import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the phone Home for design review (#388), Ocean only: 390 Pack, 390 Weather with an ALERT, 390
// Future, and 195 Pack. Run with HOME_SHOTS=<folder>; without it this is skipped. The trips go through the real create flow on
// the second app (the one wired to the fake Open-Meteo): a two-stop London trip in three days with its forecast turned on from
// the Packing page (rain on the second stay), and two later trips for the Future pill.
const SHOTS = process.env.HOME_SHOTS;
test.skip(!SHOTS, "set HOME_SHOTS=<folder> to render the design screenshots");
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 2 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

type Stop = { query: string; option: RegExp; leave: number; ret?: number };

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

test("home-p-ocean: the phone Home at 390 and 195", async ({ page }) => {
  test.setTimeout(240_000);
  await fetch(`${FAKE}/__weather-reset`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
  await page
    .context()
    .addCookies([
      { name: "appearance", value: "ocean", url: `http://localhost:${OPEN_METEO_PORT}` },
    ]);

  await plan(page, [
    { query: "london", option: /England/, leave: 3, ret: 6 },
    { query: "london", option: /Ontario/, leave: 9 },
  ]);
  await page
    .getByRole("link", { name: /London/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("button", { name: /\d+ to review/ }).first()).toBeVisible();
  // Accept the suggestions so the weather cube holds items ("Rain · N added").
  const accept = page.getByRole("button", { name: /Add all|Accept all|Apply/ }).first();
  if (await accept.count()) await accept.click();

  await plan(page, [{ query: "springfield", option: /Sangamon/, leave: 20, ret: 23 }]);
  await plan(page, [{ query: "london", option: /Ontario/, leave: 40, ret: 43 }]);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
  await shot(page, "home-p-ocean-390-pack");

  await page.getByRole("tab", { name: /^Weather/ }).click();
  await expect(page.getByRole("tab", { name: "Weather ALERT" })).toBeVisible();
  await shot(page, "home-p-ocean-390-weather-alert");

  await page.getByRole("tab", { name: /^Future/ }).click();
  await expect(page.getByRole("list", { name: "Future trips" })).toBeVisible();
  await shot(page, "home-p-ocean-390-future");

  await page.setViewportSize({ width: 195, height: 900 });
  await page.getByRole("tab", { name: /^Pack/ }).click();
  await shot(page, "home-p-ocean-195-pack");
});
