import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

test("home page is the Trips screen", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeVisible();
  // The Trips h1 is also on the loading and error screens: the loaded no-trip Home is the proof (the seed is past on the real date).
  await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
  await expect(page).toHaveTitle("Trips · Packed Smart");
});
