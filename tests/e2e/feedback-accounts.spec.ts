import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, SECOND_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import {
  accountOutboxDatabases,
  connectFeedback,
  fakeFramebriar,
  forgetFeedbackEnrollment,
  goToTrips,
  openSettingsFromNav,
  signOut,
  signOutDiscardingUnsent,
} from "./helpers/feedback";

// Whose feedback is whose (#260): the enrollment belongs to the signed-in ACCOUNT and lives on the server, and what a person has written
// but not yet sent is kept on this device for that account only. These run on desktop: they are about accounts and storage, not layout.
const SECOND_OWNER = `e2e-${SECOND_EMAIL}`;
const NOTES = "Private notes for the first account";

test.beforeEach(async ({}, testInfo) => {
  await fakeFramebriar.reset();
  await forgetFeedbackEnrollment(`e2e-${ownerEmailFor(testInfo.project.name)}`);
  await forgetFeedbackEnrollment(SECOND_OWNER);
});

/** The first account is connected, has the service down, and saves one report that can only wait on this device. */
async function firstAccountWithAWaitingReport(page: Page) {
  await signInAsOwner(page);
  await openSettingsFromNav(page);
  await connectFeedback(page);
  await goToTrips(page);
  await fakeFramebriar.setOffline(true);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByLabel("What happened?").fill(NOTES);
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await openSettingsFromNav(page);
  await expect(page.getByText("1 report waiting to send on this device.")).toBeVisible();
  await expect.poll(() => accountOutboxDatabases(page)).toHaveLength(1);
}

test("one browser, two accounts: the first account's unsent report, status and storage never reach the second", async ({
  page,
}) => {
  await firstAccountWithAWaitingReport(page);

  // Sign-out clears this account's unsent feedback from the device, and stops delivery: nothing is disconnected on the server.
  await signOutDiscardingUnsent(page);
  expect(await accountOutboxDatabases(page)).toEqual([]);
  expect((await fakeFramebriar.counts()).disconnect).toBe(0);
  await fakeFramebriar.setOffline(false);

  // The second account sees a feedback section with nothing of the first one's in it.
  await signIn(page, SECOND_EMAIL);
  await expect(page).toHaveURL(/\/$/);
  await openSettingsFromNav(page);
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toHaveCount(0);
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await expect(page.getByText(/waiting to send on this device/)).toHaveCount(0);
  await goToTrips(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeDisabled();
  expect(await page.content()).not.toContain(NOTES);

  // Nothing of the first account was ever sent through the second one's session, however long we wait.
  await page.waitForTimeout(6000);
  expect(await fakeFramebriar.delivered()).toEqual([]);
  expect((await fakeFramebriar.counts()).report).toBe(0);

  // The second account connects with its own invitation and starts with an empty outbox.
  await openSettingsFromNav(page);
  await connectFeedback(page);
  await expect(page.getByText(/waiting to send on this device/)).toHaveCount(0);
  const mine = await accountOutboxDatabases(page);
  expect(mine).toHaveLength(1);
  await signOut(page);

  // Back as the first account: still connected, no new invitation (the server kept it), and the unsent report is gone.
  await signIn(page, ownerEmailFor(test.info().project.name));
  await expect(page).toHaveURL(/\/$/);
  await openSettingsFromNav(page);
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
  await expect(page.getByText(/waiting to send on this device/)).toHaveCount(0);
  expect(await accountOutboxDatabases(page)).not.toEqual(mine);
  await page.waitForTimeout(4000);
  expect(await fakeFramebriar.delivered()).toEqual([]);
});

test("a session that simply changes (no Sign out click) still clears the first account's unsent report when the next account arrives", async ({
  page,
  context,
}) => {
  await firstAccountWithAWaitingReport(page);
  const first = await accountOutboxDatabases(page);
  await fakeFramebriar.setOffline(false);

  // The first session ends without anyone pressing Sign out (it expired, or was cleared).
  await context.clearCookies();
  await signIn(page, SECOND_EMAIL);
  await expect(page).toHaveURL(/\/$/);
  await openSettingsFromNav(page);
  await expect(page.getByText(/waiting to send on this device/)).toHaveCount(0);
  await expect.poll(() => accountOutboxDatabases(page)).not.toContain(first[0]);
  await page.waitForTimeout(4000);
  expect(await fakeFramebriar.delivered()).toEqual([]);
});

test("signed out, nothing is delivered: the waiting report is gone and the service hears nothing", async ({
  page,
}) => {
  await firstAccountWithAWaitingReport(page);
  await signOutDiscardingUnsent(page);
  await fakeFramebriar.setOffline(false);
  await page.waitForTimeout(6000);
  expect(await fakeFramebriar.delivered()).toEqual([]);
  expect((await fakeFramebriar.counts()).report).toBe(0);
});

test("cleared browser storage and a second device need no new invitation", async ({
  page,
  browser,
}, testInfo) => {
  const owner = ownerEmailFor(testInfo.project.name);
  await signInAsOwner(page);
  await openSettingsFromNav(page);
  await connectFeedback(page);
  expect((await fakeFramebriar.counts()).redeem).toBe(1);

  // Everything this browser keeps is wiped.
  await page.evaluate(async () => {
    for (const database of await indexedDB.databases()) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();

  // A second device (a separate browser profile with its own empty storage) signs in as the same account.
  const second = await browser.newContext();
  try {
    const phone = await second.newPage();
    await signIn(phone, owner);
    await expect(phone).toHaveURL(/\/$/);
    await openSettingsFromNav(phone);
    await expect(phone.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
    await expect(phone.getByLabel("Invitation")).toHaveCount(0);
    await goToTrips(phone);
    await phone.getByRole("button", { name: "Send feedback" }).click();
    const dialog = phone.getByRole("dialog", { name: "Send feedback" });
    await dialog.getByLabel("What happened?").fill("From the second device");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(
      dialog.getByRole("heading", { name: /Saved on this device|Received/ }),
    ).toBeVisible();
    await expect
      .poll(async () => (await fakeFramebriar.delivered()).length, { timeout: 30_000 })
      .toBe(1);
    expect((await fakeFramebriar.delivered())[0].report.notes).toBe("From the second device");
  } finally {
    await second.close();
  }
  // Still one redemption: neither the wipe nor the second device spent another invitation.
  expect((await fakeFramebriar.counts()).redeem).toBe(1);
});
