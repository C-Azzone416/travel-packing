import { expect, test } from "@playwright/test";

test("home page is the Trips screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Trips · Carrywell");
});
