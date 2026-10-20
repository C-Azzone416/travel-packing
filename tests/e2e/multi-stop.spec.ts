import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Multi-destination trips (epic #107, #112): create a 3-stop trip, reload, see the route and dates persisted, edit it
// to 2 stops, copy it to new dates. Fictional trips on the curated place list; the fixed clock keeps dates stable.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

async function pickStop(page: Page, stop: number, text: string, option: RegExp) {
  await page.getByRole("combobox", { name: `Destination search, Stop ${stop}` }).fill(text);
  await page.getByRole("option", { name: option }).click();
}

async function createThreeStopTrip(page: Page) {
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
  await page.getByRole("option", { name: /Lisbon/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-15");
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await pickStop(page, 2, "paris", /Paris/);
  await page.getByLabel("Leave, Stop 2").fill("2026-11-18");
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await pickStop(page, 3, "rome", /Rome/);
  await page.getByLabel("Leave, Stop 3").fill("2026-11-22");
}

const trip = (page: Page, name: string) => page.getByRole("article", { name });

test(
  "create a 3-stop trip: the route and dates persist across a reload",
  DEVICE,
  async ({ page }) => {
    await openDashboard(page);
    await createThreeStopTrip(page);
    await expect(page.locator(".route-summary")).toHaveText(
      "Lisbon → Paris → Rome · Nov 12 – Nov 22 · 10 nights",
    );
    await expect(page.getByLabel("Arrive, Stop 2")).toHaveValue("2026-11-15");
    await expect(page.getByLabel("Arrive, Stop 3")).toHaveValue("2026-11-18");

    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await expect(page.getByText(/Lisbon → Paris → Rome · Nov 12 – Nov 22/)).toBeVisible();
    await page.getByRole("button", { name: "Save trip" }).click();

    const saved = trip(page, "Lisbon → Paris → Rome");
    await expect(saved).toBeVisible();
    await expect(saved.getByText("Nov 12 – Nov 22")).toBeVisible();
    await page.reload();
    await expect(trip(page, "Lisbon → Paris → Rome")).toBeVisible();

    await trip(page, "Lisbon → Paris → Rome")
      .getByRole("link", { name: /Keep packing/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Lisbon → Paris → Rome", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".route-chip")).toContainText("Lisbon → Paris → Rome");
  },
);

test("edit the route down to 2 stops, then copy the trip to new dates", async ({ page }) => {
  await openDashboard(page);
  await createThreeStopTrip(page);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await trip(page, "Lisbon → Paris → Rome")
    .getByRole("link", { name: /Keep packing/ })
    .click();

  await page.getByRole("button", { name: "Edit route" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit route" });
  await expect(sheet.getByRole("group", { name: /^Stop \d$/ })).toHaveCount(3);
  await sheet.getByRole("button", { name: "Remove Paris" }).click();
  await sheet.getByRole("button", { name: "Remove", exact: true }).click();
  // Rome moved up: it now arrives the day Lisbon is left.
  await expect(sheet.getByLabel("Arrive, Stop 2")).toHaveValue("2026-11-15");
  await sheet.getByRole("button", { name: "Save route" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lisbon → Rome", level: 1 })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon → Rome", level: 1 })).toBeVisible();
  await expect(page.locator(".route-chip")).toContainText("Lisbon → Rome");

  await page.goto("/");
  await trip(page, "Lisbon → Rome")
    .getByRole("link", { name: /Copy trip/ })
    .click();
  await expect(page.getByRole("group", { name: "Stop 2" })).toBeVisible();
  await expect(page.getByText("Choose a new start date for the copy.").first()).toBeVisible();
  await page.getByLabel("Arrive", { exact: true }).fill("2027-02-01");
  await expect(page.locator(".route-summary")).toContainText("Feb 1 –");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("article", { name: "Lisbon → Rome" })).toHaveCount(2);
});

test("keyboard: stops can be moved with the up and down buttons", async ({ page }) => {
  await openDashboard(page);
  await createThreeStopTrip(page);
  const down = page.getByRole("button", { name: "Move Lisbon down" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".route-summary")).toContainText("Paris → Lisbon → Rome");
  await expect(page.getByRole("status", { name: "Stops updates" })).toHaveText(
    "Lisbon moved to stop 2. Dates updated.",
  );
});

test(
  "a11y: the stops step and the edit route sheet have no violations",
  DEVICE,
  async ({ page }) => {
    await openDashboard(page);
    await createThreeStopTrip(page);
    await expectAccessible(page, "stops step");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await page.getByRole("button", { name: "Save trip" }).click();
    await trip(page, "Lisbon → Paris → Rome")
      .getByRole("link", { name: /Keep packing/ })
      .click();
    await expectAccessible(page, "trip with route chip");
    await page.getByRole("button", { name: "Edit route" }).click();
    await expectAccessible(page, "edit route sheet");
  },
);
