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
    await expect(page.locator(".staples-suggestion-check .save-list-box").first()).toBeVisible();
    if (testInfo.project.name === "desktop") {
      const heading = (await page
        .getByRole("heading", { name: "Build your Staples" })
        .boundingBox())!;
      const firstCategory = (await page.getByRole("heading", { name: "Clothing" }).boundingBox())!;
      expect(Math.round(heading.x)).toBe(Math.round(firstCategory.x));
      expect((await page.locator(".staples-setup").boundingBox())!.width).toBeLessThanOrEqual(760);
    } else {
      const actions = (await page.locator(".staples-setup-actions").boundingBox())!;
      const navigation = (await page
        .getByRole("navigation", { name: "Primary navigation" })
        .boundingBox())!;
      expect(actions.y + actions.height).toBeLessThanOrEqual(navigation.y);
    }

    await page.getByRole("button", { name: "Skip for now" }).click();
    const reminder = page.getByRole("complementary", { name: "Staples setup reminder" });
    await expect(reminder).toBeVisible();
    if (testInfo.project.name === "phone") {
      const reminderBox = (await reminder.boundingBox())!;
      expect(reminderBox.width).toBeGreaterThanOrEqual(350);
      const build = (await reminder.getByRole("button", { name: "Build Staples" }).boundingBox())!;
      const dismiss = (await reminder
        .getByRole("button", { name: "Don’t remind me" })
        .boundingBox())!;
      expect(build.y + build.height).toBeLessThanOrEqual(dismiss.y);
    }
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.getByText("Your Staples list is intentionally empty.")).toBeVisible();
    await page.getByRole("link", { name: "Trips", exact: true }).click();
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

test(
  "a failed atomic setup save keeps selections, exposes busy state, and retries",
  DEVICE,
  async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    await resetStaplesSetup(`e2e-${email}`);
    await signIn(page, email);
    await page.getByRole("checkbox", { name: "Underwear" }).check();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && new URL(request.url()).pathname === "/") {
        await held;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    const click = page.getByRole("button", { name: "Save 1 Staples" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
    release();
    await click;
    const error = page.locator(".staples-setup-error");
    await expect(error).toContainText("Couldn’t save your Staples.");
    await expect(error).toContainText("Your selections are still here.");
    await expect(page.getByRole("checkbox", { name: "Underwear" })).toBeChecked();
    await expect(page.getByText("Couldn’t load your Staples setup.")).toHaveCount(0);

    await page.unroute("**/*");
    await page.getByRole("button", { name: "Try save again" }).click();
    await expect(page.getByRole("heading", { name: "Your travel ledger" })).toBeVisible();
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.locator('[data-staple-id="underwear"]')).toBeVisible();
  },
);
