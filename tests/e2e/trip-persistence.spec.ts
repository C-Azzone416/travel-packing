import { expect, test, type Page } from "@playwright/test";
import { SECOND_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// The trip screen against a REAL Postgres: what it shows after a reload is what was stored. Each test starts from the
// freshly seeded state of this project's owner (San Diego partly packed, Lisbon past, Ready, weather accepted).
const NOW = new Date("2026-10-16T12:00:00");

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const TOILETRIES = [
  "nice-makeup",
  "last-toothbrush",
  "last-toothpaste",
  "last-deodorant",
  "last-contacts",
];

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

async function openSanDiego(page: Page) {
  await openDashboard(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

async function openLisbon(page: Page) {
  await openDashboard(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
}

/** Server actions are POSTs to the page's own URL. */
const isAction = (request: { method(): string; url(): string }) =>
  request.method() === "POST" && new URL(request.url()).pathname.startsWith("/trips/");

test("a check and an uncheck are stored", async ({ page }) => {
  await openSanDiego(page);
  await row(page, "tops").getByRole("button", { name: "Pack all Everyday tops" }).click();
  await expect(row(page, "tops")).toContainText("2 of 2 packed");
  await page.reload();
  await expect(row(page, "tops")).toContainText("2 of 2 packed");
  await row(page, "tops")
    .getByRole("button", { name: "Packed, mark Everyday tops unpacked" })
    .click();
  await expect(row(page, "tops")).toContainText("0 of 2 packed");
  await page.reload();
  await expect(row(page, "tops")).toContainText("0 of 2 packed");
});

test("fast taps on a stepper show at once and are stored as ONE write with the final count", async ({
  page,
}) => {
  await openSanDiego(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (isAction(request)) writes.push(request.url());
  });
  const up = row(page, "socks").getByRole("button", { name: "Increase packed Socks" });
  await expect(row(page, "socks")).toContainText("1 of 4 packed");
  await up.click();
  await up.click();
  await up.click();
  // The tapped count is on screen before anything has been sent.
  await expect(row(page, "socks")).toContainText("4 of 4 packed");
  expect(writes).toHaveLength(0);
  await expect.poll(() => writes.length).toBe(1);
  await page.waitForTimeout(600);
  expect(writes).toHaveLength(1);
  await page.reload();
  await expect(row(page, "socks")).toContainText("4 of 4 packed");
});

test("the toiletry bag gate and its placement are stored", async ({ page }) => {
  await openSanDiego(page);
  for (const id of TOILETRIES)
    await row(page, id)
      .getByRole("button", { name: /^Pack all / })
      .click();
  await page.getByRole("button", { name: "Not yet" }).click();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();

  await page.getByRole("button", { name: "Undo placement" }).click();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Toiletry bag ready to place")).toBeVisible();
});

test("Mark as not ready is stored, and keeps every packed count", async ({ page }) => {
  await openLisbon(page);
  await expect(page.getByText("You’re ready to go.")).toBeVisible();
  const before = await page
    .getByRole("progressbar", { name: "Packing progress" })
    .getAttribute("aria-valuenow");
  await page.getByRole("button", { name: "Mark as not ready" }).click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Packing progress" })).toHaveAttribute(
    "aria-valuenow",
    before ?? "",
  );
});

test("changing a Ready trip revokes Ready, and that is stored too", async ({ page }) => {
  await openLisbon(page);
  await page.getByRole("button", { name: "Edit preferences" }).click();
  await page
    .getByRole("dialog", { name: "Edit packing preferences" })
    .getByRole("switch", { name: "Laundry access" })
    .uncheck();
  await page.getByRole("button", { name: "Update this trip" }).click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
});

test("an edit and a removal are stored", async ({ page }) => {
  await openSanDiego(page);
  await row(page, "sunglasses")
    .getByRole("button", { name: /^Sunglasses / })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit item" });
  await editor.getByLabel("Item name").fill("Polarized sunglasses");
  await editor.getByRole("button", { name: "Save item" }).click();
  await expect(row(page, "sunglasses")).toContainText("Polarized sunglasses");

  await row(page, "nice-shoes")
    .getByRole("button", { name: /^Dress shoes / })
    .click();
  await page
    .getByRole("dialog", { name: "Edit item" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await page
    .getByRole("dialog", { name: "Remove Dress shoes?" })
    .getByRole("button", { name: "Remove item" })
    .click();
  await expect(row(page, "nice-shoes")).toHaveCount(0);

  await page.reload();
  await expect(row(page, "sunglasses")).toContainText("Polarized sunglasses");
  await expect(row(page, "nice-shoes")).toHaveCount(0);
});

test("when the network fails the row says 'Not saved · Retry', keeps the user's count, and Retry stores it", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSanDiego(page);
  await page.route("**/trips/**", (route) =>
    isAction(route.request()) ? route.abort("failed") : route.continue(),
  );
  const socks = row(page, "socks");
  await socks.getByRole("button", { name: "Increase packed Socks" }).click();
  await socks.getByRole("button", { name: "Increase packed Socks" }).click();
  const retry = socks.getByRole("button", { name: "Not saved · Retry" });
  await expect(retry).toBeVisible();
  // Design: the row's Retry has a 44px hit area.
  const retryBox = (await retry.boundingBox())!;
  expect(retryBox.height).toBeGreaterThanOrEqual(43.9);
  expect(retryBox.width).toBeGreaterThanOrEqual(43.9);
  await expect(socks).toContainText("3 of 4 packed");
  await expect(page.getByRole("button", { name: "Not saved, retry" })).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-trip-not-saved.png`,
  });

  await page.unroute("**/trips/**");
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(row(page, "socks")).toContainText("3 of 4 packed");
});

test("another signed-in owner cannot open this owner's trip, and sees the same page as for a missing one", async ({
  page,
  browser,
}) => {
  await openDashboard(page);
  const href = await page
    .getByRole("link", { name: "Continue packing: San Diego" })
    .getAttribute("href");
  const second = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await second.newPage();
  await signIn(other, SECOND_EMAIL);
  await expect(other).toHaveURL(/\/$/);
  await other.goto(href as string);
  await expect(other.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
  await expect(other.getByText("San Diego")).toHaveCount(0);
  await second.close();
});

const headerArt = (page: Page) =>
  page.locator(".trip-hero [data-art-key]").getAttribute("data-art-key");

test(
  "changing the theme from the trip header is stored, and the dashboard card shows it",
  DEVICE,
  async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSanDiego(page);
    expect(await headerArt(page)).toBe("beach");
    // Placement (#155): Edit route and Change theme sit side by side in the hero card, under the title.
    const button = page.getByRole("button", { name: "Change theme" });
    const hero = (await page.locator(".trip-hero").boundingBox())!;
    const at = (await button.boundingBox())!;
    expect(at.height).toBeGreaterThanOrEqual(43.9);
    expect(at.x).toBeGreaterThanOrEqual(hero.x);
    expect(at.x + at.width).toBeLessThanOrEqual(hero.x + hero.width);
    const edit = (await page.getByRole("button", { name: "Edit route" }).boundingBox())!;
    expect(Math.abs(edit.y - at.y)).toBeLessThan(2);
    // The theme picture is an optional layer that is off for now: the saved theme is still on the page, just hidden.
    await expect(page.locator(".trip-hero .hero-picture")).toBeHidden();
    await button.click();
    const sheet = page.getByRole("dialog", { name: "Change theme" });
    await expect(sheet.getByRole("radio", { name: "Beach" })).toBeChecked();
    await expect(sheet.getByRole("radio", { name: "Beach" })).toBeFocused();
    // Every thumbnail has loaded before the picture is taken.
    await expect
      .poll(() =>
        sheet
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-theme-sheet.png`,
    });
    // Keyboard only: arrows move and select from the current theme.
    await page.keyboard.press("ArrowDown");
    await expect(sheet.getByRole("radio", { name: "Mountain / outdoors" })).toBeChecked();
    await sheet.getByRole("button", { name: "Save theme" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change theme" })).toBeFocused();
    await expect(page.getByRole("status", { name: "Packing updates" })).toHaveText(
      "Theme changed to Mountain / outdoors.",
    );
    expect(await headerArt(page)).toBe("outdoors");
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-theme-changed.png`,
    });

    await page.reload();
    expect(await headerArt(page)).toBe("outdoors");
    await page.getByRole("link", { name: "All trips" }).click();
    await expect(page.getByRole("article", { name: "San Diego" })).toBeVisible();
  },
);

test(
  "cancelling the theme sheet changes nothing, and a failed save keeps the picture and the sheet",
  DEVICE,
  async ({ page }) => {
    await openSanDiego(page);
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("radio", { name: "City" }).check();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await headerArt(page)).toBe("beach");

    await page.route("**/trips/**", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("radio", { name: "City" }).check();
    await page.getByRole("button", { name: "Save theme" }).click();
    const sheet = page.getByRole("dialog", { name: "Change theme" });
    await expect(sheet.getByRole("alert")).toContainText("Couldn’t save the theme");
    await expect(page.getByRole("button", { name: "Not saved, retry" })).toBeVisible();
    expect(await headerArt(page)).toBe("beach");
    await page.unroute("**/trips/**");
    await sheet.getByRole("button", { name: "Save theme" }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => headerArt(page)).toBe("city");
    await page.reload();
    expect(await headerArt(page)).toBe("city");
  },
);
