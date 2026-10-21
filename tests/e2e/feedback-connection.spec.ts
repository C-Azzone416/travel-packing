import { expect, test, type Page } from "@playwright/test";
import { createFakeFramebriar } from "../../src/test/fake-framebriar";
import { routeFramebriar } from "../../src/test/fake-framebriar-playwright";
import { signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";

// Connecting this browser to the feedback service from Settings (#131), against the real app and the fake service.
// The SDK keeps the connection in this browser's storage, so a reload is a real "come back later".
async function openSettings(page: Page) {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByRole("heading", { name: "Send feedback to the developer" })).toBeVisible();
}

test("connect, keep the connection across a reload, lose access, reconnect and disconnect", async ({
  page,
  context,
}) => {
  const fake = createFakeFramebriar();
  await routeFramebriar(context, fake);
  await openSettings(page);

  // Not connected: the Feedback button is there but off, and the field is a password input.
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0); // hidden on Settings
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
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
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

  await page.getByLabel("Invitation").fill(fake.issueInvitation());
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();

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
});

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
