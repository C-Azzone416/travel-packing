import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
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
