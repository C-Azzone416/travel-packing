import { expect, test } from "@playwright/test";
import { createFakeFramebriar } from "../../src/test/fake-framebriar";
import { routeFramebriar } from "../../src/test/fake-framebriar-playwright";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import { connectFeedback, goToTrips, openSettings, openSettingsFromNav } from "./helpers/feedback";

// Connecting this browser to the feedback service from Settings (#131, #133), against the real app and the fake service.
// The SDK keeps the connection in this browser's storage, so a reload is a real "come back later". The flows that depend on the
// screen (Settings and the notice on a phone: a bottom navigation, full-width buttons) run on the phone as well as on desktop.

test(
  "connect, keep the connection across a reload, lose access, reconnect and disconnect",
  DEVICE,
  async ({ page, context }) => {
    const fake = createFakeFramebriar();
    await routeFramebriar(context, fake);
    await openSettings(page);

    // Not connected: the field is a password input, and the Feedback button is not offered on Settings at all.
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
    await expect(page.getByLabel("Invitation")).toHaveAttribute("type", "password");
    await expectAccessible(page, "Settings, feedback not connected");

    const invitation = fake.issueInvitation();
    await page.getByLabel("Invitation").fill(invitation);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByLabel("Invitation")).toHaveCount(0);
    await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
    await expect(page.getByText(/^Feedback works until /)).toBeVisible();
    await expectAccessible(page, "Settings, feedback connected");

    // The invitation was used once and is not kept anywhere in the page.
    expect(await page.content()).not.toContain(invitation);
    await page.reload();
    await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();

    // On another screen the Feedback button is on.
    await goToTrips(page);
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();

    // The owner revokes the access; the next load shows the notice with a way back.
    fake.revokeAll();
    await page.reload();
    const banner = page.locator(".feedback-notice");
    await expect(banner).toContainText("Feedback needs a new invitation before it can send.");
    await expectAccessible(page, "Trips with the feedback notice");
    await banner.getByRole("link", { name: "Add invitation" }).click();
    await expect(page.getByText("Needs invitation")).toBeVisible();
    await expect(page.locator(".feedback-notice")).toHaveCount(0);

    await connectFeedback(page, fake);

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Keep connected" })).toBeFocused();
    await page
      .getByRole("group", { name: "Disconnect feedback" })
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(
      page.getByText("Disconnected. Feedback access was removed from this device and ended."),
    ).toBeVisible();
    await expect(page.getByLabel("Invitation")).toBeVisible();
  },
);

test("an invitation that does not work is explained, and the field is empty again", async ({
  page,
  context,
}) => {
  await routeFramebriar(context, createFakeFramebriar());
  await openSettings(page);
  await page.getByLabel("Invitation").fill("A".repeat(43));
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText(/^That invitation didn’t work\./)).toBeVisible();
  await expect(page.getByLabel("Invitation")).toHaveValue("");
});

test(
  "when the access expires, a notice stays on every screen until a new invitation replaces it",
  DEVICE,
  async ({ page, context }) => {
    // This enrollment lasts 15 seconds, so it expires moments after it is issued (with room for a slow phone to finish
    // connecting first).
    const fake = createFakeFramebriar({ enrollmentMs: 15_000 });
    await routeFramebriar(context, fake);
    await openSettings(page);
    await connectFeedback(page, fake);

    await goToTrips(page);
    const banner = page.locator(".feedback-notice");
    await expect(banner).toContainText("Your feedback access has expired.", { timeout: 45_000 });
    await expectAccessible(page, "Trips with the expired notice");
    // Saving a report is still possible while expired: it is kept on this device.
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();

    await banner.getByRole("link", { name: "Reconnect" }).click();
    await expect(page.locator(".status-pill", { hasText: "Expired" })).toBeVisible();
    await expect(page.locator(".feedback-notice")).toHaveCount(0);

    // A fresh invitation, now from a service whose clock is right, replaces it and clears the notice everywhere.
    fake.setEnrollmentMs(30 * 86_400_000);
    await connectFeedback(page, fake);
    await goToTrips(page);
    await expect(page.locator(".feedback-notice")).toHaveCount(0);
    await openSettingsFromNav(page);
    await expect(page.locator(".status-pill", { hasText: "Expired" })).toHaveCount(0);
  },
);

test(
  "there is no Feedback entry point on the sign-in and account screens",
  DEVICE,
  async ({ page, context }) => {
    await routeFramebriar(context, createFakeFramebriar());
    for (const path of ["/sign-in", "/sign-up", "/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
      await expect(page.locator(".feedback-notice")).toHaveCount(0);
    }
  },
);
