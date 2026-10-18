import { expect, test, type Page } from "@playwright/test";
import { OTHER_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import { expectAccessible } from "./helpers/a11y";

// Axe checks (#21) for every screen and every dialog, at both viewports (the two Playwright projects). Each state is
// reached the way a person reaches it, against the real e2e database.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

test.describe("signed out", () => {
  test("sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expectAccessible(page, "sign-in");
  });

  test("sign-in with an error", async ({ page }) => {
    await signIn(page, "owner@example.test", "wrong-password");
    await expect(page.locator("form p[role='alert']")).toContainText("incorrect");
    await expectAccessible(page, "sign-in error");
  });

  test("access denied", async ({ page }) => {
    await signIn(page, OTHER_EMAIL);
    await expect(page).toHaveURL(/\/access-denied$/);
    await expectAccessible(page, "access denied");
  });
});

test.describe("dashboard", () => {
  test("upcoming, with the quick view open", async ({ page }) => {
    await openDashboard(page);
    await expectAccessible(page, "dashboard upcoming");
    await page
      .getByRole("article", { name: "San Diego" })
      .getByRole("button", { name: /Quick view/ })
      .click();
    await expectAccessible(page, "dashboard quick view");
  });

  test("past and archive, and recently deleted", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await expect(page.getByRole("heading", { name: "Lisbon", level: 2 })).toBeVisible();
    await expectAccessible(page, "dashboard past");
  });

  test("recently deleted, with a removed trip to undo", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Remove: San Diego" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await expect(page.getByRole("heading", { name: "Recently deleted" })).toBeVisible();
    await expectAccessible(page, "dashboard recently deleted");
  });

  test("the remove confirmation", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Remove: San Diego" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "remove dialog");
  });
});

test.describe("create and copy", () => {
  async function startTrip(page: Page) {
    await openDashboard(page);
    await page.getByRole("link", { name: /New trip/ }).click();
    await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  }

  test("step 1: empty, searching, results, confirmed with the theme picker", async ({ page }) => {
    await startTrip(page);
    await expectAccessible(page, "create step 1 empty");
    await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectAccessible(page, "create step 1 results");
    await page.getByRole("option", { name: /England/ }).click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await expect(page.getByRole("group", { name: "Trip theme" })).toBeVisible();
    await expectAccessible(page, "create step 1 confirmed with theme picker");
  });

  test("step 1 with no matches, and the discard prompt", async ({ page }) => {
    await startTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill("zzzqqq");
    await expect(page.getByRole("status", { name: "Destination results" })).toHaveText(
      "No places found",
    );
    await expectAccessible(page, "create no matches");
    await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Discard this draft?" })).toBeVisible();
    await expectAccessible(page, "discard prompt");
  });

  test("step 2: shape the list", async ({ page }) => {
    await startTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
    await page.getByRole("option", { name: /England/ }).click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
    await expectAccessible(page, "create step 2");
  });
});

test.describe("trip screen", () => {
  async function openSanDiego(page: Page) {
    await openDashboard(page);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  }

  test("the screen itself, and with the Still to pack filter", async ({ page }) => {
    await openSanDiego(page);
    await expectAccessible(page, "trip screen");
    await page.getByRole("button", { name: "Still to pack" }).click();
    await expectAccessible(page, "trip screen filtered");
  });

  test("edit item, remove confirm, add Bathroom item, preferences, theme sheet", async ({
    page,
  }) => {
    await openSanDiego(page);
    await page
      .locator('[data-item-id="nice-shoes"]')
      .getByRole("button", { name: /tap to edit$/ })
      .click();
    await expectAccessible(page, "edit item dialog");
    await page.getByRole("button", { name: "Remove item" }).click();
    await expectAccessible(page, "remove item confirm");
    await page.getByRole("button", { name: "Keep item" }).click();
    await page.getByRole("button", { name: "Close dialog" }).click();

    await page.getByRole("button", { name: /Add a Bathroom item/ }).click();
    await expectAccessible(page, "add Bathroom item dialog");
    await page.getByRole("button", { name: "Close dialog" }).click();

    await page.getByRole("button", { name: "Edit preferences" }).click();
    await expectAccessible(page, "preferences dialog");
    await page.getByRole("button", { name: "Close dialog" }).click();

    await page.getByRole("button", { name: "Change theme" }).click();
    await expectAccessible(page, "theme sheet");
  });

  test("weather dialog and the toiletry bag prompt", async ({ page }) => {
    await openSanDiego(page);
    await page.getByRole("button", { name: "Review suggestion" }).click();
    await expectAccessible(page, "weather dialog");
    await page.getByRole("button", { name: "Skip" }).click();
    for (const id of [
      "nice-makeup",
      "last-toothbrush",
      "last-toothpaste",
      "last-deodorant",
      "last-contacts",
    ])
      await page
        .locator(`[data-item-id="${id}"]`)
        .getByRole("button", { name: /^Pack all / })
        .click();
    await expect(page.getByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeVisible();
    await expectAccessible(page, "toiletry bag prompt");
    await page.getByRole("button", { name: "Not yet" }).click();
    await expectAccessible(page, "toiletry bag ready to place");
  });

  test("a trip that is Ready", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
    await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
    await expectAccessible(page, "trip screen ready");
  });

  test("a trip that does not exist", async ({ page }) => {
    await openDashboard(page);
    await page.goto("/trips/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
    await expectAccessible(page, "trip not available");
  });
});

test.describe("review, settings and staples", () => {
  async function openReview(page: Page, lisbon: boolean) {
    await openDashboard(page);
    if (lisbon) {
      await page.getByRole("button", { name: /Past & archive/ }).click();
      await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
      await expect(page.getByRole("heading", { name: "Lisbon", level: 1 })).toBeVisible();
      await page.getByRole("link", { name: "Review bag again" }).click();
    } else {
      await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
      await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
      const id = new URL(page.url()).pathname.split("/").pop();
      await page.goto(`/trips/${id}/review`);
    }
    await expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();
  }

  test("review your bag with items still to pack", async ({ page }) => {
    await openReview(page, false);
    await expectAccessible(page, "review with items left");
  });

  test("review your bag on a Ready trip", async ({ page }) => {
    await openReview(page, true);
    await expectAccessible(page, "review ready");
  });

  test("settings", async ({ page }) => {
    await openDashboard(page);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expectAccessible(page, "settings");
  });
});

test.describe("error states and toasts", () => {
  const isAction = (request: { method(): string; url(): string }) => request.method() === "POST";

  test("a failed save: the error chip, its sheet, and Settings in the error state", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.route("**/*", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await page.getByRole("button", { name: "Archive: San Diego" }).click();
    const chip = page.getByRole("button", { name: "Couldn't save, retry" });
    await expect(chip).toBeVisible();
    await expectAccessible(page, "dashboard with the error chip");
    await chip.click();
    await expect(page.getByRole("dialog", { name: "Couldn’t save" })).toBeVisible();
    await expectAccessible(page, "retry sheet");
    await page.getByRole("dialog").getByRole("button", { name: "Dismiss" }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expectAccessible(page, "settings in the error state");
  });

  test("a trip row that did not save, and the toast after a removal", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
    await page.route("**/trips/**", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await page
      .locator('[data-item-id="socks"]')
      .getByRole("button", { name: "Increase packed Socks" })
      .click();
    await expect(page.getByRole("button", { name: "Not saved · Retry" })).toBeVisible();
    await expectAccessible(page, "a row that did not save");
  });

  test("the Undo toast after removing a trip", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Remove: San Diego" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
    await expect(page.getByRole("button", { name: /Undo/ })).toBeVisible();
    await expectAccessible(page, "undo toast");
  });
});

test.describe("keyboard and focus", () => {
  test("the first tab stop is the skip link, and it moves focus to the main content", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("a dialog traps Tab, keeps the page behind it unreachable, closes on Escape and returns focus", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
    const opener = page.getByRole("button", { name: "Edit preferences" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit packing preferences" });
    await expect(dialog).toBeVisible();
    // The page behind the dialog is inert: no control outside it can be reached with Tab.
    const outside = await page.evaluate(() => {
      const seen = new Set<boolean>();
      for (let step = 0; step < 40; step += 1) {
        const active = document.activeElement as HTMLElement | null;
        seen.add(Boolean(active?.closest('[role="dialog"]')));
        // Move focus the way Tab would, within what the browser allows.
        const focusables = Array.from(
          document.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((node) => !node.closest("[inert]"));
        const index = focusables.indexOf(active as HTMLElement);
        focusables[(index + 1) % focusables.length]?.focus();
      }
      return [...seen];
    });
    expect(outside).toEqual([true]);
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

test.describe("narrow screens and large text", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("nothing needs sideways scrolling at 320px on the main screens", async ({ page }) => {
    await openDashboard(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow(), "dashboard").toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
    expect(await overflow(), "trip screen").toBeLessThanOrEqual(0);
    await expectAccessible(page, "trip screen at 320px");
    await page.getByRole("link", { name: "Back to trips" }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    expect(await overflow(), "settings").toBeLessThanOrEqual(0);
  });

  test("text can be enlarged to 200% without losing anything", async ({ page }) => {
    await openDashboard(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /New trip/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(page, "dashboard with 200% text at 320px");
  });
});
