import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

test("home page is the Trips screen", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "Your travel ledger", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Trips · Packed Smart");
});
