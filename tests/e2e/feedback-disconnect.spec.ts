import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import {
  ageEnrollment,
  connectFeedback,
  fakeFramebriar,
  heldFor,
  openSettings,
} from "./helpers/feedback";

// Settings > Disconnect against the real app, its server and database, with a fake Framebriar behind the server (#304). Each result
// the person can see is checked in the page AND at the store: a finished disconnect leaves no sealed credential behind, and a failed one
// keeps it so the retry can still revoke. The words are written out here on purpose: they are the contract, not a re-import of it.
test.beforeEach(() => fakeFramebriar.reset());

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

const TEXT = {
  ended: "Disconnected. Your feedback access was ended.",
  nothing: "You weren’t connected, so there was nothing to end.",
  unrevocable:
    "Disconnected. We removed this app’s copy of your feedback connection, but we couldn’t end the access itself. It stops on its own at the deadline Framebriar set. Feedback can’t be sent from this app.",
  uncertain:
    "We couldn’t confirm whether your access was ended. You may still be connected. Try again.",
  pending:
    "Connecting didn’t finish, so it can’t be ended just yet. Wait up to 15 minutes and try again.",
  offline: "You’re offline, so nothing was changed. Disconnect again when you’re back online.",
} as const;

async function pressDisconnect(page: Page) {
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("group", { name: "Disconnect feedback" })
    .getByRole("button", { name: "Disconnect" })
    .click();
}

const success = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const failure = (page: Page, text: string) =>
  page.getByRole("alert").filter({ hasText: `⚠ ${text}` });

async function connectedSettings(page: Page) {
  await openSettings(page);
  await connectFeedback(page);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 1, redemptions: 0 });
}

test("connected: Disconnect ends the access, says so, refreshes to not connected, and the credential is gone", async ({
  page,
}) => {
  await connectedSettings(page);
  await pressDisconnect(page);
  await expect(success(page, TEXT.ended)).toBeVisible();
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  expect((await fakeFramebriar.counts()).disconnect).toBe(1);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("an expired record still has a Disconnect, and it says there was nothing to end", async ({
  page,
}) => {
  await connectedSettings(page);
  await ageEnrollment(ownerId(), "expired");
  await page.reload();
  await expect(page.locator(".status-pill", { hasText: "Expired" })).toBeVisible();
  await pressDisconnect(page);
  await expect(success(page, TEXT.nothing)).toBeVisible();
  // Framebriar was not asked to revoke anything: the access was already over.
  expect((await fakeFramebriar.counts()).disconnect).toBe(0);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a family Framebriar no longer knows (401) leaves nothing to end, and the record is still removed", async ({
  page,
}) => {
  await connectedSettings(page);
  await fakeFramebriar.failNext("disconnect", { kind: "status", status: 401 });
  await pressDisconnect(page);
  await expect(success(page, TEXT.nothing)).toBeVisible();
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a connection this server can no longer open: Disconnect erases it and does NOT say access was ended", async ({
  page,
}) => {
  await connectedSettings(page);
  await ageEnrollment(ownerId(), "unreadable");
  await page.reload();
  await expect(page.locator(".status-pill", { hasText: "Needs invitation" })).toBeVisible();
  await pressDisconnect(page);
  const message = success(page, TEXT.unrevocable);
  await expect(message).toBeVisible();
  await expect(message).not.toContainText("was ended");
  await expect(message).not.toContainText("nothing to end");
  expect((await fakeFramebriar.counts()).disconnect).toBe(0);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a failure keeps the credential, says so in an alert, and the retry works", async ({
  page,
}) => {
  await connectedSettings(page);
  await fakeFramebriar.failNext("disconnect", { kind: "network" });
  await pressDisconnect(page);
  await expect(failure(page, TEXT.uncertain)).toBeVisible();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
  expect(await heldFor(ownerId())).toEqual({ enrollments: 1, redemptions: 0 });

  await pressDisconnect(page);
  await expect(success(page, TEXT.ended)).toBeVisible();
  // The old failure is cleared when the retry starts.
  await expect(failure(page, TEXT.uncertain)).toHaveCount(0);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("a connection that did not finish: Disconnect says to wait up to 15 minutes and removes nothing", async ({
  page,
}) => {
  await openSettings(page);
  await fakeFramebriar.failNext("redeem", { kind: "network" });
  await page.getByLabel("Invitation").fill(await fakeFramebriar.issueInvitation());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/may have been used/)).toBeVisible();
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 1 });
  // A pending attempt is a record: Disconnect is offered, though nothing is connected.
  await pressDisconnect(page);
  await expect(failure(page, TEXT.pending)).toBeVisible();
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 1 });
});

test("offline: nothing was changed, and Disconnect can be pressed again", async ({ page }) => {
  await connectedSettings(page);
  await page.route("**/api/feedback/enrollment/disconnect", (route) => route.abort("failed"));
  await pressDisconnect(page);
  await expect(failure(page, TEXT.offline)).toBeVisible();
  expect(await heldFor(ownerId())).toEqual({ enrollments: 1, redemptions: 0 });
  await page.unroute("**/api/feedback/enrollment/disconnect");
  await pressDisconnect(page);
  await expect(success(page, TEXT.ended)).toBeVisible();
});

test("nothing held, nothing to disconnect: no Disconnect button", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
});

test("a stale view: Disconnect in a second tab, then in this one, is 'nothing to end'", async ({
  page,
  context,
}) => {
  await connectedSettings(page);
  const other = await context.newPage();
  await other.goto("/settings");
  await expect(other.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await pressDisconnect(other);
  await expect(success(other, TEXT.ended)).toBeVisible();
  // This tab still shows Connected, and its Disconnect finds nothing held.
  await pressDisconnect(page);
  await expect(success(page, TEXT.nothing)).toBeVisible();
  expect((await fakeFramebriar.counts()).disconnect).toBe(1);
  expect(await heldFor(ownerId())).toEqual({ enrollments: 0, redemptions: 0 });
});

test("the phone layout keeps every result inside the card", DEVICE, async ({ page }) => {
  await connectedSettings(page);
  await ageEnrollment(ownerId(), "unreadable");
  await page.reload();
  await pressDisconnect(page);
  const message = success(page, TEXT.unrevocable);
  await expect(message).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
