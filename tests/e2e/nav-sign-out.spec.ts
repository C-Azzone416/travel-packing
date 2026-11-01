import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { feedbackOff } from "./helpers/feedback";

// Sign out in the main navigation (#117, #293). Where feedback is off (production) it is the 4th tab on a phone, after Settings;
// where feedback is on, the 4th tab is Feedback and Sign out is the Settings row on a phone. From 721px the header holds it either way.
test(
  "feedback off: Sign out is the 4th tab, one tap ends the session",
  DEVICE,
  async ({ page }, testInfo) => {
    await feedbackOff(page);
    await signInAsOwner(page);
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    const signOut = nav.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await expect(nav.getByRole("button")).toHaveCount(1);
    await expect(nav.locator(".nav-feedback")).toHaveCount(0);
    await expect(signOut).toHaveAttribute(
      "title",
      `Signed in as ${ownerEmailFor(testInfo.project.name)}`,
    );
    // Four items, never the current page, the same hit size as the links.
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(signOut).not.toHaveAttribute("aria-current", /.+/);
    const box = await signOut.boundingBox();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
    const link = await nav.getByRole("link", { name: "Settings" }).boundingBox();
    expect(Math.round(box!.height)).toBe(Math.round(link!.height));
    await expectAccessible(page, "dashboard with Sign out as the 4th tab");

    await signOut.click();
    await expect(page).toHaveURL(/\/sign-in/);
    // Signed out for real: the app routes send the visitor back to sign-in.
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  },
);

test(
  "feedback on, on a phone: the 4th tab is Feedback, and Sign out is in Settings",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await signInAsOwner(page);
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("button", { name: "Send feedback report" })).toBeVisible();
    // The wide-screen copy is not drawn, so it is not a tab stop or in the accessibility tree.
    await expect(nav.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await nav.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  },
);

test("from 721px the header holds Sign out, one tap ends the session", async ({ page }) => {
  await signInAsOwner(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: "Send feedback report" })).toBeVisible();
  await nav.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
