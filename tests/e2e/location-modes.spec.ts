import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Two copies of the app run during e2e (see playwright.config.ts and support/ports.ts): the default one
// (LOCATION_PROVIDER unset, so the curated list) and one with LOCATION_PROVIDER=open-meteo, pointed at a
// local fake geocoder. No real network is used anywhere.
const OPEN_METEO_APP = `http://localhost:${OPEN_METEO_PORT}`;
const FAKE_GEOCODER = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;

interface FakeQuery {
  params: Record<string, string>;
  headers: string[];
}

const received = async (name: string): Promise<FakeQuery[]> => {
  const all = (await (await fetch(`${FAKE_GEOCODER}/__queries`)).json()) as FakeQuery[];
  return all.filter((query) => query.params.name === name);
};

async function openNewTrip(page: Page) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
}

test.describe("curated mode (LOCATION_PROVIDER unset)", () => {
  test("answers from the built-in list and never contacts the geocoder", async ({
    page,
  }, testInfo) => {
    const unique = `spring${testInfo.project.name}`;
    await openNewTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill(unique);
    await expect(page.getByText("No places found. Check the spelling.")).toBeVisible();
    await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("Île-de-France, France");
    expect(await received(unique)).toEqual([]);
    expect(await received("paris")).toEqual([]);
  });
});

test.describe("open-meteo mode (LOCATION_PROVIDER=open-meteo, fake geocoder)", () => {
  test.use({ baseURL: OPEN_METEO_APP });

  test("lists provider places, tells identical ones apart, and a picked place can be saved", async ({
    page,
  }, testInfo) => {
    const unique = `spring${testInfo.project.name}`;
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    await openNewTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill(unique);
    const options = page.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText("Springfield");
    await expect(options.nth(0)).toContainText("Illinois, United States · Sangamon County");
    await expect(options.nth(1)).toContainText("Illinois, United States · Cook County");
    await expect(page.getByRole("status", { name: "Destination results" })).toHaveText(
      "2 places found",
    );

    await options.nth(1).click();
    await expect(page.getByText("Destination confirmed")).toBeVisible();
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.getByRole("article", { name: "Springfield" })).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Springfield" }).getByText("Illinois, United States"),
    ).toBeVisible();
  });

  test("sends the provider only the typed text, and none of the user's credentials", async ({
    page,
  }, testInfo) => {
    // No fake place starts with "zzq", so this search finds nothing.
    const unique = `zzq${testInfo.project.name}`;
    await openNewTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill(unique);
    await expect(page.getByRole("status", { name: "Destination results" })).toHaveText(
      "No places found",
    );
    const queries = await received(unique);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    for (const query of queries) {
      expect(Object.keys(query.params).sort()).toEqual(["count", "format", "language", "name"]);
      expect(query.params).toMatchObject({
        count: "5",
        language: "en",
        format: "json",
        name: unique,
      });
      expect(query.headers).not.toContain("cookie");
      expect(query.headers).not.toContain("authorization");
    }
  });

  test("a provider failure shows the unavailable state with Retry, never free text", async ({
    page,
  }) => {
    await openNewTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill("boom");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Location search is unavailable right now. Try again." }),
    ).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(0);
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await page
      .getByRole("button", { name: "Continue to packing preferences" })
      .click({ force: true });
    await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("screenshots of the picker states", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    const shot = (name: string) =>
      page.screenshot({
        path: `test-results/screenshots/${testInfo.project.name}-location-${name}.png`,
      });
    const field = () => page.getByRole("combobox", { name: "Destination search" });
    await openNewTrip(page);

    await field().fill("slow");
    await expect(page.getByText("Searching…").first()).toBeVisible();
    await shot("searching");

    await field().fill("zzqscreens");
    await expect(page.getByRole("status", { name: "Destination results" })).toHaveText(
      "No places found",
    );
    await shot("no-matches");

    await field().fill("boom");
    await expect(
      page.getByRole("alert").filter({ hasText: "Location search is unavailable right now." }),
    ).toBeVisible();
    await shot("unavailable");

    await field().fill(`spring${testInfo.project.name}`);
    await expect(page.getByRole("option")).toHaveCount(2);
    await shot("results");

    await page.getByRole("option").nth(1).click();
    await expect(page.getByText("Destination confirmed")).toBeVisible();
    await shot("confirmed");
  });
});
