import { expect, test } from "@playwright/test";
import { signIn, setupEmailFor } from "./helpers/auth";
import { resetStaplesSetup } from "./helpers/database";
import { DEVICE } from "./helpers/device";

test(
  "first-use Staples setup is optional, resumable, and personal",
  DEVICE,
  async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    const ownerId = `e2e-${email}`;
    await resetStaplesSetup(ownerId);
    await signIn(page, email);

    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Underwear" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Socks" })).not.toBeChecked();

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toBeVisible();
    await page.getByRole("button", { name: "Build Staples" }).click();
    await page.getByRole("checkbox", { name: "Socks" }).check();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toBeVisible();

    await page.getByRole("button", { name: "Build Staples" }).click();
    await expect(page.getByRole("checkbox", { name: "Socks" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await page.getByRole("button", { name: "Edit" }).click();
    const editor = page.getByRole("dialog", { name: "Edit staple" });
    await editor.getByRole("radio", { name: /^Smart/ }).check();
    await editor.getByRole("radio", { name: /^Toiletry bag/ }).check();
    await editor.getByRole("switch", { name: "Pack last" }).check();
    await editor.getByRole("button", { name: "Save staple" }).click();
    await page.getByRole("button", { name: "Save 1 Staples" }).click();

    await expect(page.getByRole("heading", { name: "Your travel ledger" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Staples" }).click();
    const underwear = page.locator('[data-staple-id="underwear"]');
    await expect(underwear).toContainText("1 smart");
    await expect(underwear).toContainText("Pack last");
    await expect(underwear).toContainText("Toiletry bag");

    await underwear.getByRole("button", { name: "Edit Underwear" }).click();
    await page
      .getByRole("dialog", { name: "Edit staple" })
      .getByRole("button", { name: "Remove" })
      .click();
    await page
      .getByRole("dialog", { name: "Remove Underwear?" })
      .getByRole("button", { name: "Remove staple" })
      .click();
    await expect(underwear).toHaveCount(0);
  },
);
