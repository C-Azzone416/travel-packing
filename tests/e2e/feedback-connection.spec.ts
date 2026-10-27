import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import {
  connectFeedback,
  connectedOnTrips,
  fakeFramebriar,
  goToTrips,
  openSettings,
  openSettingsFromNav,
} from "./helpers/feedback";

// Connecting the signed-in ACCOUNT to the feedback service from Settings (#131, #133, #260), against the real app and its server, with a fake
// Framebriar behind the server. The enrollment lives on the server, so a reload (or another device) is a real "come back later". The flows
// that depend on the screen (Settings and the notice on a phone: a bottom navigation, full-width buttons) run on the phone as well as desktop.
test.beforeEach(() => fakeFramebriar.reset());

test(
  "connect once, stay connected across a reload, and disconnect with the access ended",
  DEVICE,
  async ({ page }) => {
    await openSettings(page);

    // Not connected: the field is a password input, and the Feedback button is not offered on Settings at all.
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
    await expect(page.getByLabel("Invitation")).toHaveAttribute("type", "password");
    await expectAccessible(page, "Settings, feedback not connected");

    const invitation = await fakeFramebriar.issueInvitation();
    await page.getByLabel("Invitation").fill(invitation);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByLabel("Invitation")).toHaveCount(0);
    await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
    await expect(page.getByText(/^Feedback works until /)).toBeVisible();
    await expectAccessible(page, "Settings, feedback connected");

    // The invitation was used once and is not kept anywhere in the page.
    expect(await page.content()).not.toContain(invitation);
    expect((await fakeFramebriar.counts()).redeem).toBe(1);
    await page.reload();
    await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
    // Nothing in the browser's storage holds a credential or the invitation.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toContain(invitation);
    expect(await page.evaluate(() => document.cookie)).not.toContain(invitation);

    // On another screen the Feedback button is on.
    await goToTrips(page);
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();
    await openSettingsFromNav(page);

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Keep connected" })).toBeFocused();
    await page
      .getByRole("group", { name: "Disconnect feedback" })
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(page.getByText("Disconnected. Your feedback access was ended.")).toBeVisible();
    await expect(page.getByLabel("Invitation")).toBeVisible();
    expect((await fakeFramebriar.counts()).disconnect).toBe(1);
  },
);

test("an invitation that does not work is explained, and the field is empty again", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByLabel("Invitation").fill("A".repeat(43));
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /^⚠ That invitation didn’t work\./ }),
  ).toBeVisible();
  await expect(page.getByLabel("Invitation")).toHaveValue("");
});

test("a lost answer is finished by pasting the same invitation again, which is spent once", async ({
  page,
}) => {
  await openSettings(page);
  const invitation = await fakeFramebriar.issueInvitation();
  // Framebriar's answer to the redemption never arrives (the call made it, the reply did not).
  await fakeFramebriar.failNext("redeem", { kind: "network" });
  await page.getByLabel("Invitation").fill(invitation);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /may have been used/ })).toBeVisible();
  await expect(page.getByText("Not finished")).toBeVisible();
  await expect(page.getByText(/Paste the same invitation again to finish/)).toBeVisible();

  await connectFeedback(page, invitation);
  await expect(page.getByText("Not finished")).toHaveCount(0);
});

test(
  "when the access expires, a notice stays on every screen until a new invitation replaces it",
  DEVICE,
  async ({ page }) => {
    // This enrollment lasts 15 seconds, so it expires moments after it is issued (with room for a slow phone to finish connecting first).
    await fakeFramebriar.setEnrollmentMs(15_000);
    await openSettings(page);
    await connectFeedback(page);

    await goToTrips(page);
    const banner = page.locator(".feedback-notice");
    await expect(async () => {
      await page.reload();
      await expect(banner).toContainText("Your feedback access has expired.", { timeout: 1500 });
    }).toPass({ timeout: 45_000 });
    await expectAccessible(page, "Trips with the expired notice");
    // The Feedback button is off while expired, and reports saved before stay on this device.
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeDisabled();

    await banner.getByRole("link", { name: "Reconnect" }).click();
    await expect(page.locator(".status-pill", { hasText: "Expired" })).toBeVisible();
    await expect(page.locator(".feedback-notice")).toHaveCount(0);

    // A fresh invitation replaces the expired enrollment and clears the notice everywhere.
    await fakeFramebriar.setEnrollmentMs(30 * 86_400_000);
    await connectFeedback(page);
    await goToTrips(page);
    await expect(page.locator(".feedback-notice")).toHaveCount(0);
    await openSettingsFromNav(page);
    await expect(page.locator(".status-pill", { hasText: "Expired" })).toHaveCount(0);
  },
);

test("access ended at Framebriar is noticed when a report is sent, and the report is kept", async ({
  page,
}) => {
  await connectedOnTrips(page);
  await fakeFramebriar.revokeAll();
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByLabel("What happened?").fill("Sent after the owner revoked access");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  // The delivery attempt tells the server, which now says so: a notice, and the report waits on this device.
  const banner = page.locator(".feedback-notice");
  await expect(banner).toContainText("Your feedback access was ended.", { timeout: 40_000 });
  await expectAccessible(page, "Trips with the ended notice");
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeDisabled();
  await banner.getByRole("link", { name: "Add invitation" }).click();
  await expect(page.locator(".status-pill", { hasText: "Ended" })).toBeVisible();
  await expect(page.getByText("1 report waiting to send on this device.")).toBeVisible();
  expect(await fakeFramebriar.delivered()).toHaveLength(0);
});

test("feedback switched off at Framebriar is shown as such, with no way to connect", async ({
  page,
}) => {
  await connectedOnTrips(page);
  await fakeFramebriar.failNext("report", { kind: "status", status: 403 });
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByLabel("What happened?").fill("Sent while switched off");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  const banner = page.locator(".feedback-notice");
  await expect(banner).toContainText("Feedback is switched off for now.", { timeout: 40_000 });
  await banner.getByRole("link", { name: "See details" }).click();
  await expect(page.locator(".status-pill", { hasText: "Switched off" })).toBeVisible();
  await expect(page.getByLabel("Invitation")).toHaveCount(0);
});

test(
  "there is no Feedback entry point on the sign-in and account screens",
  DEVICE,
  async ({ page }) => {
    for (const path of ["/sign-in", "/sign-up", "/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
      await expect(page.locator(".feedback-notice")).toHaveCount(0);
    }
  },
);
