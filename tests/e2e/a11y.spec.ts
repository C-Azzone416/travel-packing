import { expect, test, type Locator, type Page } from "@playwright/test";
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

test.describe("more states", () => {
  const isAction = (request: { method(): string }) => request.method() === "POST";

  test("the dashboard while it loads, and when it cannot load", async ({ page }) => {
    await openDashboard(page);
    // Answers held back until the check is done: the skeleton shows for as long as we need.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/*", async (route) => {
      if (isAction(route.request())) await held;
      await route.continue().catch(() => undefined);
    });
    await page.reload();
    await expect(page.getByRole("region", { name: "Loading trips" })).toBeVisible();
    await expectAccessible(page, "dashboard loading");
    release();
    await page.unroute("**/*");
    // No answer at all: the load error card.
    await page.route("**/*", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await page.reload();
    await expect(page.getByText("Couldn’t load your trips.")).toBeVisible();
    await expectAccessible(page, "dashboard load error");
  });

  test("review after a change took the trip out of Ready", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
    await page.getByRole("link", { name: "Review bag again" }).click();
    await expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();
    await page
      .locator('[data-item-id="tops"]')
      .getByRole("button", { name: /mark unpacked/ })
      .click();
    await expect(page.getByText("No longer ready: an item was unchecked")).toBeVisible();
    await expectAccessible(page, "review after Ready was revoked");
  });
});

// The badge never touches the text before it. On a wide row it sits on the category line with a gap of at least 6px;
// when the line is too narrow it wraps below that line instead. Either way it is below the name.
async function expectBadgeClear(row: Locator): Promise<{ sameLine: boolean }> {
  const name = (await row.locator(".item-name").boundingBox())!;
  const badge = (await row.locator(".timing-tag").boundingBox())!;
  const last = await row.locator(".item-meta").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.firstChild as Node);
    const rects = Array.from(range.getClientRects());
    const box = rects[rects.length - 1];
    return { right: box.right, top: box.top, bottom: box.bottom };
  });
  const sameLine = badge.y < last.bottom - 1 && badge.y + badge.height > last.top + 1;
  if (sameLine) expect(badge.x - last.right).toBeGreaterThanOrEqual(6);
  else expect(badge.y).toBeGreaterThanOrEqual(last.bottom - 1);
  expect(badge.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  return { sameLine };
}

test.describe("design's known items", () => {
  test("the error chip stays on one line, and the Pack last badge keeps its distance", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.route("**/*", (route) =>
      route.request().method() === "POST" ? route.abort("failed") : route.continue(),
    );
    await page.getByRole("button", { name: "Archive: San Diego" }).click();
    const chip = page.getByRole("button", { name: "Couldn't save, retry" });
    await expect(chip).toBeVisible();
    await page.unroute("**/*");
    // One line of 12px text plus padding: well under two lines.
    expect((await chip.boundingBox())!.height).toBeLessThan(60);
    await page.reload();
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    const row = page.locator('[data-item-id="last-toothbrush"]');
    await expect(row).toBeVisible();
    await expectBadgeClear(row);
  });

  test("on a wide row the Pack last badge sits on the category line, 6px clear of the text", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDashboard(page);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    const row = page.locator('[data-item-id="last-toothbrush"]');
    await expect(row).toBeVisible();
    expect((await expectBadgeClear(row)).sameLine).toBe(true);
  });

  test("group labels are the same size as field labels", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
    await page
      .locator('[data-item-id="sunglasses"]')
      .getByRole("button", { name: /^Sunglasses / })
      .click();
    const legend = page.getByRole("group", { name: "Apply this change to" }).locator("legend");
    const label = page.getByLabel("Item name").locator("xpath=ancestor::label");
    const size = (node: import("@playwright/test").Locator) =>
      node.evaluate((element) => getComputedStyle(element).fontSize);
    expect(await size(legend)).toBe(await size(label));
  });

  test("the fixed bottom navigation never covers the last content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await openDashboard(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const nav = (await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox())!;
    const lastBottom = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      const content = Array.from(main.querySelectorAll("*")).filter(
        (node) => node.getBoundingClientRect().height > 0,
      );
      return Math.max(...content.map((node) => node.getBoundingClientRect().bottom));
    });
    expect(lastBottom).toBeLessThanOrEqual(nav.y + 1);
  });

  test("date inputs are tied to their hint and notice", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("link", { name: /New trip/ }).click();
    for (const label of ["Leave", "Return"]) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute("aria-describedby", "date-hint date-notice");
    }
    await expect(page.locator("#date-hint")).toContainText("Return cannot be before departure");
  });

  test("with reduced motion no animation runs", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDashboard(page);
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === "running").length,
    );
    expect(running).toBe(0);
  });
});

test("screenshots of the visual fixes (after)", async ({ page }, testInfo) => {
  const shot = (name: string, options: { fullPage?: boolean } = {}) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-a11y-${name}.png`,
      ...options,
    });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  // Rows with the Pack last badge, and the packed count.
  await page.locator('[data-item-id="last-toothbrush"]').scrollIntoViewIfNeeded();
  await shot("pack-last-badge");
  // The scope legend in the item editor.
  await page
    .locator('[data-item-id="sunglasses"]')
    .getByRole("button", { name: /^Sunglasses / })
    .click();
  await shot("editor-legend");
  await page.getByRole("button", { name: "Close dialog" }).click();
  // The green bag card, after placing the bag.
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
  await page.getByRole("button", { name: "Not yet" }).click();
  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Toiletry bag is in the suitcase")).toBeVisible();
  await page.getByText("Toiletry bag is in the suitcase").scrollIntoViewIfNeeded();
  await shot("bag-card-in-suitcase");
  // The error chip on one line.
  await page.route("**/trips/**", (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  await page
    .locator('[data-item-id="socks"]')
    .getByRole("button", { name: "Increase packed Socks" })
    .click();
  await expect(page.getByRole("button", { name: "Couldn't save, retry" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("error-chip");
});

test.describe("staples", () => {
  async function openStaples(page: Page) {
    await openDashboard(page);
    await page.goto("/staples");
    await expect(
      page.getByRole("heading", { name: "Every trip starts here", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Clothing" })).toBeVisible();
  }

  test("the list, and the Pack last filter", async ({ page }) => {
    await openStaples(page);
    await expectAccessible(page, "staples list");
    await page.getByRole("button", { name: "Pack last" }).click();
    await expect(page.getByRole("button", { name: "Pack last" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectAccessible(page, "staples pack last filter");
  });

  test("the editor for a Bathroom staple, and the add form with a duplicate name", async ({
    page,
  }) => {
    await openStaples(page);
    await page
      .locator('[data-staple-id="last-toothbrush"]')
      .getByRole("button", { name: "Edit Toothbrush" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "staple editor (Bathroom)");
    await page.getByRole("dialog").getByRole("button", { name: /close/i }).click();
    await page.getByRole("button", { name: /Add/ }).click();
    await page.getByRole("dialog").getByLabel("Item name").fill("socks");
    await expect(page.getByText("You already have Socks.")).toBeVisible();
    await expectAccessible(page, "staple add form, duplicate name");
  });
});
