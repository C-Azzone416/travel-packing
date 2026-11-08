import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, SECOND_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import { chooseFromMenu, openPastAndArchive } from "./helpers/menu";
import { phoneHomeLayout } from "./helpers/device";

// Home is the laptop suitcase view from 1024px (#387) and the phone suitcase below it (#388); this spec runs on the phone Home.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// These run against a REAL Postgres (the e2e database server), so what the dashboard shows after a reload or in a new
// session is what was actually stored. Each project signs in as its own seeded owner, and every test leaves that owner's
// data as it found it (San Diego live and not archived), so tests can run in any order.

// A fixed clock keeps the seeded sample trips stable: San Diego upcoming, Lisbon past.
const NOW = new Date("2026-10-16T12:00:00");

const card = (page: Page, name: string) => page.getByRole("article", { name });
const tag = (page: Page, name: string) => page.getByRole("region", { name });
const sanDiegoHeading = (page: Page) => page.getByRole("heading", { name: "San Diego", level: 2 });

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  await expect(sanDiegoHeading(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(sanDiegoHeading(page)).toBeVisible();
});

test("an archived trip is still archived after a reload, and restoring it persists too", async ({
  page,
}) => {
  await chooseFromMenu(page, "San Diego", "Archive");
  await expect(sanDiegoHeading(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
  await openPastAndArchive(page);
  await expect(card(page, "San Diego").getByText("Archived trip")).toBeVisible();

  await card(page, "San Diego").getByRole("button", { name: "Restore: San Diego" }).click();
  await page.reload();
  await expect(sanDiegoHeading(page)).toBeVisible();
});

test("a removed trip stays removed after a reload, and Undo brings back the identical trip", async ({
  page,
}) => {
  const before = await tag(page, "San Diego").innerText();
  // The trip's packed/total quantities (the Pack pill) must survive the remove and the undo exactly.
  const packBefore = await page.getByRole("tab", { name: /^Pack \d+\/\d+$/ }).innerText();
  await chooseFromMenu(page, "San Diego", "Remove");
  await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
  await expect(sanDiegoHeading(page)).toHaveCount(0);

  await page.reload();
  await expect(sanDiegoHeading(page)).toHaveCount(0);
  await openPastAndArchive(page);
  await expect(page.getByRole("button", { name: "Undo remove: San Diego" })).toBeVisible();

  await page.getByRole("button", { name: "Undo remove: San Diego" }).click();
  await page.reload();
  await expect(sanDiegoHeading(page)).toBeVisible();
  expect(await tag(page, "San Diego").innerText()).toBe(before);
  expect(await page.getByRole("tab", { name: /^Pack \d+\/\d+$/ }).innerText()).toBe(packBefore);
  await openPastAndArchive(page);
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
});

test("changes are there in a brand-new session (another device)", async ({ page, browser }) => {
  await chooseFromMenu(page, "San Diego", "Archive");
  await expect(sanDiegoHeading(page)).toHaveCount(0);

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const device = await other.newPage();
    await device.clock.setFixedTime(NOW);
    await signIn(device, ownerEmailFor(test.info().project.name));
    await expect(device).toHaveURL(/\/$/);
    await expect(device.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
    await openPastAndArchive(device);
    await expect(card(device, "San Diego").getByText("Archived trip")).toBeVisible();
  } finally {
    await other.close();
  }

  await openPastAndArchive(page);
  await card(page, "San Diego").getByRole("button", { name: "Restore: San Diego" }).click();
  await page.reload();
  await expect(sanDiegoHeading(page)).toBeVisible();
});

test("a second user sees none of the owner's trips, before or after the owner changes them", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const second = await other.newPage();
    await second.clock.setFixedTime(NOW);
    await signIn(second, SECOND_EMAIL);
    await expect(second).toHaveURL(/\/$/);
    await expect(second.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
    await expect(sanDiegoHeading(second)).toHaveCount(0);

    // The owner removes a trip; the second user's view is unaffected and shows nothing of it.
    await chooseFromMenu(page, "San Diego", "Remove");
    await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
    await expect(sanDiegoHeading(page)).toHaveCount(0);

    // Still the first-run Home after a reload: none of the owner's trips or removed trips reach this account, so there is no
    // Past & archive to open (the owner's Undo remove is not theirs to see).
    await second.reload();
    await expect(second.getByRole("heading", { name: "Where to first?" })).toBeVisible();
    await expect(second.getByRole("button", { name: /Past & archive/ })).toHaveCount(0);
    await expect(second.getByText("San Diego")).toHaveCount(0);
    await expect(second.getByText("Lisbon")).toHaveCount(0);
  } finally {
    await other.close();
  }

  await openPastAndArchive(page);
  await page.getByRole("button", { name: "Undo remove: San Diego" }).click();
  await page.reload();
  await expect(sanDiegoHeading(page)).toBeVisible();
});

test("the dashboard loads its trips through the server (no sample data in the page itself)", async ({
  page,
}) => {
  // The trips are fetched by a server action after the page loads; they are not baked into the HTML or the bundle.
  const html = await (await page.request.get("/")).text();
  expect(html).not.toContain("San Diego");
  expect(html).not.toContain("Lisbon");
  await openDashboard(page);
});
