import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Sign out from the main navigation (#117, design on #117): the 4th item after Settings on the phone's bottom bar and at the end
// of the desktop rail, one tap and no confirm, with the signed-in address only as its tooltip.
test(
  "Sign out is in the main nav, on both sizes, and one tap ends the session",
  DEVICE,
  async ({ page }, testInfo) => {
    await signInAsOwner(page);
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    // Visible without opening Settings.
    const signOut = nav.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
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
    // Keyboard: it is reachable by tabbing from the last link.
    await nav.getByRole("link", { name: "Settings" }).focus();
    await page.keyboard.press("Tab");
    await expect(signOut).toBeFocused();
    await expectAccessible(page, "dashboard with Sign out in the nav");

    await signOut.click();
    await expect(page).toHaveURL(/\/sign-in/);
    // Signed out for real: the app routes send the visitor back to sign-in.
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  },
);
