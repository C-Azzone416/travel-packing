import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the laptop Packing view for design review (#385): the three colour schemes at 1280 and 1024, with
// the weather review row open and in Edit list mode. Run with PACKING_SHOTS=<folder>; without it these are skipped, so the
// normal run neither writes files nor pays for them. The trip is made through the real create flow on the second app (the
// one wired to the fake Open-Meteo), with weather off at first so the forecast arrives as suggestions to review.
const SHOTS = process.env.PACKING_SHOTS;
const THEMES = ["ocean", "evergreen", "dusk"] as const;
const WIDTHS = [1280, 1024] as const;
test.skip(!SHOTS, "set PACKING_SHOTS=<folder> to render the design screenshots");
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 1.5 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`${theme} ${width}: Packing, review row open, Edit list`, async ({ page }) => {
      test.setTimeout(180_000);
      await fetch(`${FAKE}/__weather-reset`);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signInAsOwner(page);
      await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
      await page
        .context()
        .addCookies([
          { name: "appearance", value: theme, url: `http://localhost:${OPEN_METEO_PORT}` },
        ]);
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
      await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Turn on" }).click();
      const review = page.getByRole("button", { name: /\d+ to review/ });
      await expect(review).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-scheme", theme);
      const tag = `${theme}-${width}`;

      await shot(page, `pk-l-${tag}`);
      await review.click();
      await expect(review).toHaveAttribute("aria-expanded", "true");
      await shot(page, `pk-l-rev-${tag}`);
      await review.click();
      await page.getByRole("button", { name: "Edit list" }).click();
      await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
      await expect(page.getByText("Trip saved")).toHaveCount(0);
      await shot(page, `pk-l-edit-${tag}`);
    });
  }
}
