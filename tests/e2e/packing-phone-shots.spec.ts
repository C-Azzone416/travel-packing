import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { cubeNav, openCube, tick } from "./helpers/packing";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the phone Packing view for design review (#386): Ocean at 390 (default, the filters, the review rows
// open, Edit list, after All in, Next), Ocean at 320 with 200% text and at 195, Evergreen and Dusk at 390, and the laptop at
// 1024 for the "unchanged" check. Run with PACKING_SHOTS=<folder>; without it these are skipped, so the normal run neither writes
// files nor pays for them. The trip is made through the real create flow on the second app (the one wired to the fake
// Open-Meteo), with weather off at first so the forecast arrives as suggestions to review.
const SHOTS = process.env.PACKING_SHOTS;
test.skip(!SHOTS, "set PACKING_SHOTS=<folder> to render the design screenshots");
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 2 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function setScheme(page: Page, theme: string) {
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
  await page
    .context()
    .addCookies([{ name: "appearance", value: theme, url: `http://localhost:${OPEN_METEO_PORT}` }]);
}

async function makeTrip(page: Page, theme: string) {
  await fetch(`${FAKE}/__weather-reset`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setScheme(page, theme);
  await page.goto("/");
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
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("button", { name: /\d+ to review/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", theme);
  // Some of the first cube is packed, so the filters and the counts have something to show.
  for (const id of ["tops-short", "underwear"]) await tick(page, id).catch(() => undefined);
  await openCube(page, "Clothing");
}

test("ocean 390: default, filters, review rows, Edit list, All in and Next", async ({ page }) => {
  test.setTimeout(240_000);
  await makeTrip(page, "ocean");
  await shot(page, "pk-p-ocean-390");
  await page.getByRole("button", { name: /^To pack/ }).click();
  await shot(page, "pk-p-ocean-390-filter-to-pack");
  await page.getByRole("button", { name: /^Packed \d/ }).click();
  await shot(page, "pk-p-ocean-390-filter-packed");
  await page.getByRole("button", { name: /^All \d/ }).click();
  await page.getByRole("button", { name: /\d+ to review/ }).click();
  await expect(page.getByText(/^New: /)).toBeVisible();
  await shot(page, "pk-p-rev-ocean-390");
  await page.getByRole("button", { name: /\d+ to review/ }).click();
  await page.getByRole("button", { name: "Edit list" }).click();
  await shot(page, "pk-p-edit-ocean-390");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /^All in/ }).click();
  await expect(page.locator(".toast-region")).toContainText(/Packed/);
  await shot(page, "pk-p-allin-ocean-390");
  await page.getByRole("button", { name: /^Next: / }).click();
  await expect(page.locator("[data-cube] h2")).toBeFocused();
  await shot(page, "pk-p-next-ocean-390");
  // The cube bar scrolled to the open cube.
  await cubeNav(page).getByRole("button").last().click();
  await shot(page, "pk-p-last-ocean-390");
});

test("ocean 320 at 200% text and 195", async ({ page }) => {
  test.setTimeout(240_000);
  await makeTrip(page, "ocean");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeGreaterThanOrEqual(31.9);
  await shot(page, "pk-p-ocean-320-200", true);
  await page.getByRole("button", { name: /\d+ to review/ }).click();
  await shot(page, "pk-p-rev-ocean-320-200", true);
  await page.setViewportSize({ width: 195, height: 640 });
  await shot(page, "pk-p-rev-ocean-195-200", true);
  await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
  await shot(page, "pk-p-ocean-195", true);
});

for (const theme of ["evergreen", "dusk"] as const) {
  test(`${theme} 390: default and review rows`, async ({ page }) => {
    test.setTimeout(240_000);
    await makeTrip(page, theme);
    await shot(page, `pk-p-${theme}-390`);
    await page.getByRole("button", { name: /\d+ to review/ }).click();
    await shot(page, `pk-p-rev-${theme}-390`);
  });
}

test("1024: the laptop view is unchanged", async ({ page }) => {
  test.setTimeout(240_000);
  await makeTrip(page, "ocean");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await shot(page, "pk-l-ocean-1024", true);
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await shot(page, "pk-p-ocean-1023");
});
