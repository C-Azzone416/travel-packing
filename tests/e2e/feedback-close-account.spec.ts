import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, SECOND_EMAIL, signIn } from "./helpers/auth";
import {
  accountOutboxDatabases,
  accountRows,
  connectFeedback,
  fakeFramebriar,
  forgetFeedbackEnrollment,
  heldFor,
  openSettingsFromNav,
  restoreSetupRecord,
} from "./helpers/feedback";

// Closing an account requires disconnecting feedback first, inside the Close account sheet (#261), against the real app, its server
// and database, with a fake Framebriar behind the server. These really close the shared second e2e account, so each test puts that
// account's "password set through a link" record back afterwards. Closure is enabled in this synthetic environment only.
const SECOND_OWNER = `e2e-${SECOND_EMAIL}`;

const TEXT = {
  ended: "Disconnected. Your feedback access was ended.",
  uncertain:
    "We couldn’t confirm whether your access was ended. You may still be connected. Try again.",
  bounced:
    "Feedback is still connected to your account, possibly from another device or tab. Disconnect it to continue. Nothing was deleted.",
} as const;

// Closure signs in, reauthenticates, deletes and signs out for real: give each test room.
test.setTimeout(90_000);

test.beforeEach(async () => {
  await fakeFramebriar.reset();
  await forgetFeedbackEnrollment(SECOND_OWNER);
});
test.afterEach(async () => {
  await restoreSetupRecord(SECOND_EMAIL, E2E_PASSWORD);
});

async function connectedSecondAccount(page: Page) {
  await signIn(page, SECOND_EMAIL);
  await expect(page).toHaveURL(/\/$/);
  await openSettingsFromNav(page);
  await connectFeedback(page);
}

const dialogOf = (page: Page, name: string) => page.getByRole("dialog", { name });
const openCloseAccount = async (page: Page) => {
  await page.getByRole("main").getByRole("button", { name: "Close account" }).click();
};

async function confirmClosure(page: Page) {
  const dialog = dialogOf(page, "Close your account?");
  await dialog.getByLabel("Current password").fill(E2E_PASSWORD);
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await dialog.getByRole("button", { name: "Close account permanently" }).click();
}

test("connected: Disconnect inside the sheet, Continue, then close; no credential or account row remains", async ({
  page,
}) => {
  await connectedSecondAccount(page);
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 1, redemptions: 0 });
  await openCloseAccount(page);

  const step1 = dialogOf(page, "Disconnect feedback first");
  await expect(step1).toBeVisible();
  await expect(step1.getByText("Step 1 of 2")).toBeVisible();
  // Closure is not reachable from this step: no password field, no DELETE field, no Close button.
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  await expect(page.getByLabel("Type DELETE to confirm")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close account permanently" })).toHaveCount(0);

  await step1.getByRole("button", { name: "Disconnect" }).click();
  await expect(step1.getByRole("status").filter({ hasText: TEXT.ended })).toBeVisible();
  const next = step1.getByRole("button", { name: "Continue" });
  await expect(next).toBeFocused();
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 0, redemptions: 0 });
  expect((await fakeFramebriar.counts()).disconnect).toBe(1);
  // Nothing has been deleted yet.
  expect((await accountRows(SECOND_OWNER)).owner).toBe(true);

  await next.click();
  const step2 = dialogOf(page, "Close your account?");
  await expect(step2.getByText("Step 2 of 2")).toBeVisible();
  await expect(step2.getByLabel("Current password")).toBeFocused();
  await confirmClosure(page);

  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  expect(await accountRows(SECOND_OWNER)).toEqual({ owner: false, fence: false });
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a failed disconnect stays on step 1 with a retry, deletes nothing, and the retry then works", async ({
  page,
}) => {
  await connectedSecondAccount(page);
  await openCloseAccount(page);
  const step1 = dialogOf(page, "Disconnect feedback first");
  await fakeFramebriar.failNext("disconnect", { kind: "network" });
  await step1.getByRole("button", { name: "Disconnect" }).click();
  await expect(step1.getByRole("alert").filter({ hasText: `⚠ ${TEXT.uncertain}` })).toBeVisible();
  await expect(step1.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 1, redemptions: 0 });
  expect((await accountRows(SECOND_OWNER)).owner).toBe(true);

  await step1.getByRole("button", { name: "Try again" }).click();
  await expect(step1.getByRole("status").filter({ hasText: TEXT.ended })).toBeVisible();
  await expect(step1.getByRole("alert").filter({ hasText: TEXT.uncertain })).toHaveCount(0);
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a stale sheet: feedback connected from another tab after it opened is refused by the server, and nothing is deleted", async ({
  page,
  context,
}) => {
  await signIn(page, SECOND_EMAIL);
  await expect(page).toHaveURL(/\/$/);
  await openSettingsFromNav(page);
  await openCloseAccount(page);
  // Nothing is connected yet, so the sheet is straight on the confirmation.
  const step2 = dialogOf(page, "Close your account?");
  await expect(step2).toBeVisible();
  await expect(step2.getByText(/Step \d of 2/)).toHaveCount(0);

  // A second tab (another device would do the same) connects feedback.
  const other = await context.newPage();
  await other.goto("/settings");
  await connectFeedback(other);
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 1, redemptions: 0 });

  await confirmClosure(page);
  const step1 = dialogOf(page, "Disconnect feedback first");
  await expect(step1).toBeVisible();
  await expect(step1.getByRole("alert").filter({ hasText: TEXT.bounced })).toBeVisible();
  await expect(step1.getByText("Step 1 of 2")).toBeVisible();
  // The typed password and DELETE are gone from the page, and nothing was deleted or revoked.
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  expect(await page.content()).not.toContain(E2E_PASSWORD);
  expect(await accountRows(SECOND_OWNER)).toEqual({ owner: true, fence: false });
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 1, redemptions: 0 });
  expect((await fakeFramebriar.counts()).disconnect).toBe(0);

  // Disconnect here, continue, and closure now works; the confirmation comes back blank.
  await step1.getByRole("button", { name: "Disconnect" }).click();
  await step1.getByRole("button", { name: "Continue" }).click();
  await expect(step2.getByLabel("Current password")).toHaveValue("");
  await expect(step2.getByLabel("Type DELETE to confirm")).toHaveValue("");
  await confirmClosure(page);
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  expect(await accountRows(SECOND_OWNER)).toEqual({ owner: false, fence: false });
});

test("a hand-made request cannot close an account that still holds feedback (the server guard, not the page)", async ({
  page,
}) => {
  await connectedSecondAccount(page);
  expect((await accountRows(SECOND_OWNER)).owner).toBe(true);
  // Skip the page's step 1 entirely: open the confirmation by hiding the status the sheet decides on, so it goes straight to step 2.
  await page.route("**/api/feedback/enrollment", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            v: 1,
            status: "not-connected",
            expiresAt: null,
            redemption: "none",
            hasRecord: false,
            outboxKey: null,
          }),
        })
      : route.fallback(),
  );
  await page.reload();
  await openCloseAccount(page);
  await expect(dialogOf(page, "Close your account?")).toBeVisible();
  await confirmClosure(page);
  // The server still said no.
  await expect(dialogOf(page, "Disconnect feedback first")).toBeVisible();
  expect(await accountRows(SECOND_OWNER)).toEqual({ owner: true, fence: false });
  expect(await heldFor(SECOND_OWNER)).toEqual({ enrollments: 1, redemptions: 0 });
});

test("unsent reports on this device are named in step 1 and gone from this device after closure", async ({
  page,
}) => {
  await connectedSecondAccount(page);
  await fakeFramebriar.setOffline(true);
  await page.locator(".feedback-send-action").click();
  const sheet = page.getByRole("dialog", { name: "Send feedback" });
  await sheet.getByLabel("What happened?").fill("Notes that must not outlive the account");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => accountOutboxDatabases(page)).toHaveLength(1);
  await fakeFramebriar.setOffline(false);

  await openCloseAccount(page);
  const step1 = dialogOf(page, "Disconnect feedback first");
  await expect(
    step1.getByText(
      "1 unsent report on this device will be deleted when you close your account. They won’t be sent.",
    ),
  ).toBeVisible();
  await expect(
    step1.getByText("Reports saved on your other devices can’t be reached from here."),
  ).toBeVisible();
  await step1.getByRole("button", { name: "Disconnect" }).click();
  await step1.getByRole("button", { name: "Continue" }).click();
  // Disconnecting alone leaves the unsent report on the device; closure removes it.
  await expect.poll(() => accountOutboxDatabases(page)).toHaveLength(1);
  await confirmClosure(page);
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  await expect.poll(() => accountOutboxDatabases(page)).toHaveLength(0);
  expect((await fakeFramebriar.delivered()).length).toBe(0);
});
