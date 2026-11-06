import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { chooseFromMenu } from "./helpers/menu";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import { pickRoute, reviewAndCreate, setRouteDates, toList, toWhen } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

// Multi-destination trips (epic #107, #112): create a 3-stop trip, reload, see the route and dates persisted, edit it
// to 2 stops, copy it to new dates. Fictional trips on the curated place list; the fixed clock keeps dates stable.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const THREE = [
  { query: "lisbon", option: /Lisbon/ },
  { query: "paris", option: /Paris/ },
  { query: "rome", option: /Rome/ },
];

/** Plan a trip, Where: Lisbon, Paris, Rome in order. */
async function pickThreeStops(page: Page) {
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pickRoute(page, THREE);
}

/** Plan a trip, When: Lisbon 12-15 Nov, Paris 15-18, Rome 18-22. */
async function createThreeStopTrip(page: Page) {
  await pickThreeStops(page);
  await toWhen(page);
  await setRouteDates(page, ["2026-11-12", "2026-11-15", "2026-11-18", "2026-11-22"]);
}

const trip = (page: Page, name: string) => page.getByRole("article", { name });

test(
  "create a 3-stop trip: the route and dates persist across a reload",
  DEVICE,
  async ({ page }) => {
    await legacyPackingLayout(page);
    await openDashboard(page);
    await createThreeStopTrip(page);
    await expect(page.getByLabel("Arrive, Stop 2")).toHaveValue("2026-11-15");
    await expect(page.getByLabel("Arrive, Stop 3")).toHaveValue("2026-11-18");

    await toList(page);
    await reviewAndCreate(page);

    const saved = trip(page, "Lisbon → Paris → Rome");
    await expect(saved).toBeVisible();
    await expect(saved.getByText("Nov 12 – Nov 22")).toBeVisible();
    await page.reload();
    await expect(trip(page, "Lisbon → Paris → Rome")).toBeVisible();

    await trip(page, "Lisbon → Paris → Rome")
      .getByRole("link", { name: /(Continue|Keep) packing/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Lisbon → Paris → Rome", level: 1 }),
    ).toBeVisible();
    // The title is the route, so the header does not repeat it as a chip.
    await expect(page.locator(".route-chip")).toHaveCount(0);
  },
);

test("edit the route down to 2 stops, then copy the trip to new dates", async ({ page }) => {
  await legacyPackingLayout(page);
  await openDashboard(page);
  await createThreeStopTrip(page);
  await toList(page);
  await reviewAndCreate(page);
  await trip(page, "Lisbon → Paris → Rome")
    .getByRole("link", { name: /(Continue|Keep) packing/ })
    .click();

  await page.getByRole("button", { name: "Edit trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit trip" });
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
  await expect(page.locator(".route-chip")).toHaveCount(0);

  await page.goto("/");
  await chooseFromMenu(page, "Lisbon → Rome", "Copy trip");
  await expect(page.getByRole("button", { name: "Remove Rome" })).toBeVisible();
  await toWhen(page);
  await expect(page.getByText("Choose a new start date for the copy.").first()).toBeVisible();
  await page.getByLabel("Arrive", { exact: true }).fill("2027-02-01");
  await expect(page.getByLabel("Arrive, Stop 2")).toHaveValue("2027-02-04");
  await toList(page);
  await reviewAndCreate(page);
  await expect(page.getByRole("article", { name: "Lisbon → Rome" })).toHaveCount(2);
});

test("keyboard: stops can be moved with the up and down buttons", async ({ page }) => {
  await openDashboard(page);
  await pickThreeStops(page);
  const down = page.getByRole("button", { name: "Move Lisbon down" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-stop-key]")).toHaveText([/Paris/, /Lisbon/, /Rome/]);
  await expect(page.getByRole("status", { name: "Stops updates" })).toHaveText(
    "Lisbon moved to stop 2",
  );
  // Focus stays where the person was working, on the control that moved the stop.
  await expect(page.getByRole("button", { name: "Move Lisbon down" })).toBeFocused();
});

test(
  "a11y: the stops step and the edit route sheet have no violations",
  DEVICE,
  async ({ page }) => {
    // Builds a 3-stop trip, saves it, opens it and runs axe on three screens: more than the default 30 s on a slow phone runner.
    test.slow();
    await openDashboard(page);
    await createThreeStopTrip(page);
    // #377: the palette's accent and good pairs fall short of 4.5:1 on the redesigned screens; nothing else is exempt.
    await expectAccessible(page, "plan: when step, three stops", { disable: ["color-contrast"] });
    await toList(page);
    await reviewAndCreate(page);
    await trip(page, "Lisbon → Paris → Rome")
      .getByRole("link", { name: /(Continue|Keep) packing/ })
      .click();
    await expectAccessible(page, "trip with route chip");
    await page.getByRole("button", { name: "Edit trip" }).click();
    await expectAccessible(page, "edit route sheet");
  },
);
