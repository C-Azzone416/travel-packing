import { expect, type Page } from "@playwright/test";
import type { FakeFramebriar } from "../../../src/test/fake-framebriar";
import { signInAsOwner } from "./auth";

// Shared steps for the feedback specs (#131-#133). They drive the real app and the real SDK; only the service is the fake.
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" });

export async function openSettings(page: Page) {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await nav(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Send feedback to the developer" })).toBeVisible();
}

export async function goToTrips(page: Page) {
  await nav(page).getByRole("link", { name: "Trips" }).click();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
}

export async function connectFeedback(page: Page, fake: FakeFramebriar) {
  await page.getByLabel("Invitation").fill(fake.issueInvitation());
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
}

/** Signed in, connected through Settings, and back on the trips screen with the Feedback button on. */
export async function connectedOnTrips(page: Page, fake: FakeFramebriar) {
  await openSettings(page);
  await connectFeedback(page, fake);
  await goToTrips(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();
}

export async function openSettingsFromNav(page: Page) {
  await nav(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Send feedback to the developer" })).toBeVisible();
}
