import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { SampleLocation } from "../../src/domain/trip-stops";
import { LOCATIONS } from "../../src/domain/locations";
import { setOwnerAppearance, setOwnerHomeCity } from "./helpers/database";
import { OWNER_EMAIL, signIn } from "./helpers/auth";

const SHOTS = process.env.SETTINGS_SUITCASE_SHOTS;
test.skip(!SHOTS, "set SETTINGS_SUITCASE_SHOTS=<folder> to render the #413 review set");

async function shot(page: import("@playwright/test").Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: "disabled" });
}

const OWNER_ID = `e2e-${OWNER_EMAIL}`;
const SEATTLE = LOCATIONS.find((place) => place.id === "us-wa-seattle")!;
const LONG_HOME: SampleLocation = {
  id: "ar-k-catamarca-san-fernando",
  city: "San Fernando del Valle de Catamarca",
  region: "Catamarca",
  country: "Argentina",
  countryCode: "AR",
  label: "San Fernando del Valle de Catamarca, Catamarca, Argentina",
};

async function homeShot(
  page: import("@playwright/test").Page,
  options: {
    name: string;
    width: number;
    scheme: "ocean" | "evergreen";
    place: SampleLocation | null;
  },
) {
  await setOwnerAppearance(OWNER_ID, options.scheme);
  await setOwnerHomeCity(OWNER_ID, options.place);
  await page.setViewportSize({ width: options.width, height: 844 });
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", options.scheme);

  const home = page.locator(".settings-cube").filter({
    has: page.getByRole("heading", { name: "Home", level: 2 }),
  });
  await expect(home).toBeVisible();
  await expect(
    home.getByRole("button", {
      name: options.place ? `Home city: ${options.place.city}, change` : "Home city, choose",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  mkdirSync(SHOTS!, { recursive: true });
  await home.screenshot({
    path: `${SHOTS}/${options.name}.png`,
    animations: "disabled",
  });
}

test("focused exact-head Settings suitcase review set", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/$/);

  for (const scheme of ["ocean", "evergreen", "dusk"] as const) {
    await setOwnerAppearance(`e2e-${OWNER_EMAIL}`, scheme);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
    await page.setViewportSize({ width: 1280, height: 980 });
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await shot(page, `settings-${scheme}-1280x980`);
  }

  await setOwnerAppearance(`e2e-${OWNER_EMAIL}`, "ocean");
  for (const size of [
    { width: 768, height: 900, tag: "768x900" },
    { width: 390, height: 844, tag: "390x844" },
    { width: 195, height: 844, tag: "195x844" },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await shot(page, `settings-ocean-${size.tag}`);
  }
});

test("exact-head Home city states and ellipsis", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/$/);

  for (const state of [
    { name: "home-ocean-unset-1280", width: 1280, scheme: "ocean", place: null },
    { name: "home-ocean-set-1280", width: 1280, scheme: "ocean", place: SEATTLE },
    { name: "home-ocean-unset-390", width: 390, scheme: "ocean", place: null },
    { name: "home-ocean-set-390", width: 390, scheme: "ocean", place: SEATTLE },
    { name: "home-ocean-unset-195", width: 195, scheme: "ocean", place: null },
    { name: "home-ocean-set-195", width: 195, scheme: "ocean", place: SEATTLE },
    { name: "home-evergreen-set-1280", width: 1280, scheme: "evergreen", place: SEATTLE },
    { name: "home-ocean-long-390", width: 390, scheme: "ocean", place: LONG_HOME },
  ] as const) {
    await homeShot(page, state);
  }

  const field = page.locator(".home-city-field > span").first();
  await expect(field).toHaveAttribute("data-text", LONG_HOME.city);
  await expect(page.locator(".home-city-change")).toHaveAttribute("data-text", "Change");
  const ellipsis = await field.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    overflow: getComputedStyle(node).overflow,
    textOverflow: getComputedStyle(node).textOverflow,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }));
  expect(ellipsis.scrollWidth).toBeGreaterThan(ellipsis.clientWidth);
  expect(ellipsis).toMatchObject({
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
});
