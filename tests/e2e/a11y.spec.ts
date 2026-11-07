import { expect, test, type Page } from "@playwright/test";
import { OTHER_EMAIL, setupEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { resetStaplesSetup } from "./helpers/database";
import { chooseFromMenu, openPastAndArchive, planATrip } from "./helpers/menu";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import { expectPacking, openCube, openEditor, tick } from "./helpers/packing";
import { serverActionId } from "./helpers/server-action";
import { chooseMode, nextButton, pickPlace, setDates, toWhen } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
// Two subjects stay at the laptop width: the Staples screen and the error chip on the laptop Home.
test.beforeEach(async ({ page }, testInfo) => {
  if (/staples|a failed save: the error chip/.test(testInfo.titlePath.join(" "))) return;
  await phoneHomeLayout(page);
});

// Axe checks (#21) for every screen and every dialog, at both viewports (the two Playwright projects). Each state is
// reached the way a person reaches it, against the real e2e database.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

test.describe("signed out", DEVICE, () => {
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

test.describe("dashboard", DEVICE, () => {
  test("the phone Home: each pill's panel", async ({ page }) => {
    await openDashboard(page);
    // #377: the palette's accent and muted pairs fall short of 4.5:1 on the redesigned screens; nothing else is exempt.
    const palette = { disable: ["color-contrast"] };
    await expectAccessible(page, "dashboard pack panel", palette);
    for (const [pill, label] of [
      [/^Weather/, "weather"],
      [/^Future/, "future"],
      [/^Stamps/, "stamps"],
    ] as const) {
      await page.getByRole("tab", { name: pill }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await expectAccessible(page, `dashboard ${label} panel`, palette);
    }
  });

  test("past and archive, and recently deleted", async ({ page }) => {
    await openDashboard(page);
    await openPastAndArchive(page);
    await expect(page.getByRole("heading", { name: "Lisbon", level: 2 })).toBeVisible();
    await expectAccessible(page, "dashboard past");
  });

  test("recently deleted, with a removed trip to undo", async ({ page }) => {
    await openDashboard(page);
    await chooseFromMenu(page, "San Diego", "Remove");
    await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
    await openPastAndArchive(page);
    await expect(page.getByRole("heading", { name: "Recently deleted" })).toBeVisible();
    await expectAccessible(page, "dashboard recently deleted");
  });

  test("the remove confirmation", async ({ page }) => {
    await openDashboard(page);
    await chooseFromMenu(page, "San Diego", "Remove");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "remove dialog");
  });
});

test.describe("plan a trip", DEVICE, () => {
  // #377: the palette's accent, good and info pairs fall short of 4.5:1 on the redesigned screens; nothing else is exempt.
  const palette = { disable: ["color-contrast"] };

  async function startTrip(page: Page) {
    await openDashboard(page);
    await planATrip(page);
    await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
  }

  test("where: empty, results, and a place chosen", async ({ page }) => {
    await startTrip(page);
    await expectAccessible(page, "plan where empty", palette);
    await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectAccessible(page, "plan where results", palette);
    await page.getByRole("option", { name: /England/ }).click();
    await expectAccessible(page, "plan where with a place and a second stop", palette);
    await page.getByRole("button", { name: "Add a stop" }).click();
    await expectAccessible(page, "plan where with a stop to choose", palette);
  });

  test("where with no matches", async ({ page }) => {
    await startTrip(page);
    await page.getByRole("combobox", { name: "Destination search" }).fill("zzzqqq");
    await expect(page.getByRole("status", { name: "Destination results" })).toHaveText(
      "No places found",
    );
    await expectAccessible(page, "plan no matches", palette);
  });

  test("when, how, the starting list and the review", async ({ page }) => {
    test.slow();
    await startTrip(page);
    await pickPlace(page, "lon", /England/);
    await toWhen(page);
    await expectAccessible(page, "plan when", palette);
    await setDates(page, "2026-11-12", "2026-11-16");
    await nextButton(page).click();
    await expectAccessible(page, "plan how", palette);
    await chooseMode(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
    await expectAccessible(page, "plan starting list", palette);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
    await expectAccessible(page, "plan review", palette);
  });
});

test.describe("trip screen", DEVICE, () => {
  // Colour contrast of the redesigned Packing screen is tracked in #377: exempted here, per call, and nowhere else.
  const options = { disable: ["color-contrast"] };

  async function openSanDiego(page: Page) {
    await openDashboard(page);
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
  }

  test("the screen itself, and with the To pack filter", async ({ page }) => {
    await openSanDiego(page);
    await expectAccessible(page, "trip screen", options);
    await page.getByRole("button", { name: /^To pack/ }).click();
    await expectAccessible(page, "trip screen filtered", options);
    await page.getByRole("button", { name: "Edit list" }).click();
    await expectAccessible(page, "trip screen in Edit list", options);
  });

  test("edit item, remove confirm, add Bathroom item and preferences", async ({ page }) => {
    await openSanDiego(page);
    await openEditor(page, "nice-shoes");
    await expectAccessible(page, "edit item dialog", options);
    await page.getByRole("button", { name: "Remove item" }).click();
    await expectAccessible(page, "remove item confirm", options);
    await page.getByRole("button", { name: "Keep item" }).click();
    await page.getByRole("button", { name: "Close dialog" }).click();

    await openCube(page, "Toiletries");
    await page.getByRole("button", { name: /Add a Bathroom item/ }).click();
    await expectAccessible(page, "add Bathroom item dialog", options);
    await page.getByRole("button", { name: "Close dialog" }).click();

    await page.getByRole("button", { name: "Edit preferences" }).click();
    await expectAccessible(page, "preferences dialog", options);
    await page.getByRole("button", { name: "Close dialog" }).click();
  });

  test("the toiletry bag prompt", async ({ page }) => {
    await openSanDiego(page);
    for (const id of ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"])
      await tick(page, id);
    await expect(page.getByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeVisible();
    await expectAccessible(page, "toiletry bag prompt", options);
    await page.getByRole("button", { name: "Not yet" }).click();
    await expectAccessible(page, "toiletry bag ready to place", options);
  });

  test("a trip that is Ready", async ({ page }) => {
    await openDashboard(page);
    await openPastAndArchive(page);
    await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
    await expectPacking(page);
    await expectAccessible(page, "trip screen ready", options);
  });

  test("a trip that does not exist", async ({ page }) => {
    await openDashboard(page);
    await page.goto("/trips/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
    await expectAccessible(page, "trip not available");
  });
});

test.describe("review, settings and staples", DEVICE, () => {
  async function openReview(page: Page, lisbon: boolean) {
    await openDashboard(page);
    if (lisbon) {
      await openPastAndArchive(page);
      await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
      await expectPacking(page);
      await page.getByRole("link", { name: "Review bag again" }).click();
    } else {
      await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
      await expectPacking(page);
      const id = new URL(page.url()).pathname.split("/").pop();
      await page.goto(`/trips/${id}/review`);
    }
    await expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();
  }

  test("review your bag with items still to pack", async ({ page }) => {
    await phoneHomeLayout(page);
    await openReview(page, false);
    await expectAccessible(page, "review with items left");
  });

  test("review your bag on a Ready trip", async ({ page }) => {
    await phoneHomeLayout(page);
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

  test("Staples setup with rule summaries on the selected rows", async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    await resetStaplesSetup(`e2e-${email}`);
    await signIn(page, email);
    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Toothbrush" }).check();
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await expect(page.getByRole("button", { name: "Edit Underwear, 1 per day" })).toBeVisible();
    await expectAccessible(page, "staples setup with rules");
  });
});

test.describe("error states and toasts", DEVICE, () => {
  const isAction = (request: { method(): string; url(): string }) => request.method() === "POST";

  test("a failed save: the error chip, its sheet, and Settings in the error state", async ({
    page,
  }, testInfo) => {
    await openDashboard(page);
    const feedback = page.getByRole("button", { name: "Send feedback" });
    const wordmark = page.locator(".shell-brand strong");
    const feedbackBefore = await feedback.boundingBox();
    const wordmarkBefore = await wordmark.boundingBox();
    expect(feedbackBefore).not.toBeNull();
    expect(wordmarkBefore).not.toBeNull();
    await page.route("**/*", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await chooseFromMenu(page, "San Diego", "Archive");
    const chip = page.getByRole("button", { name: "Not saved, retry" });
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    const feedbackAfter = await feedback.boundingBox();
    const wordmarkAfter = await wordmark.boundingBox();
    expect(chipBox?.height).toBeGreaterThanOrEqual(44);
    expect(feedbackAfter?.x).toBe(feedbackBefore?.x);
    expect(wordmarkAfter?.height).toBe(wordmarkBefore?.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (testInfo.project.name === "phone") {
      await expect(chip.locator(".sync-text-compact")).toBeVisible();
      await expect(chip.locator(".sync-text")).toBeHidden();
    } else {
      await expect(chip.locator(".sync-text")).toBeVisible();
      await expect(chip.locator(".sync-text-compact")).toBeHidden();
    }
    // #377: the redesigned Home (map placeholder, countdown badge) has palette pairs below 4.5:1; only that rule, only on this check.
    await expectAccessible(page, "dashboard with the error chip", { disable: ["color-contrast"] });
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
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
    await page.route("**/trips/**", (route) =>
      isAction(route.request()) ? route.abort("failed") : route.continue(),
    );
    await tick(page, "socks");
    await expect(page.getByRole("button", { name: "Not saved · Retry" })).toBeVisible();
    await expectAccessible(page, "a row that did not save", { disable: ["color-contrast"] });
  });

  test("the Undo toast after removing a trip", async ({ page }) => {
    await openDashboard(page);
    await chooseFromMenu(page, "San Diego", "Remove");
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
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
    const opener = page.getByRole("button", { name: "Edit preferences" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit trip" });
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

test.describe("narrow screens and large text", DEVICE, () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("nothing needs sideways scrolling at 320px on the main screens", async ({ page }) => {
    await openDashboard(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow(), "dashboard").toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
    expect(await overflow(), "trip screen").toBeLessThanOrEqual(0);
    await expectAccessible(page, "trip screen at 320px", { disable: ["color-contrast"] });
    await page.goto("/");
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
    // Plan a trip is in the Future pill's panel on the phone Home.
    await page.getByRole("tab", { name: /^Future/ }).click();
    await expect(page.getByRole("link", { name: /Plan a trip/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    // #377: the redesigned Home's palette pairs fall short of 4.5:1; nothing else is exempt.
    await expectAccessible(page, "dashboard with 200% text at 320px", {
      disable: ["color-contrast"],
    });
  });
});

test.describe("more states", DEVICE, () => {
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
    await expect(page.getByRole("region", { name: "Loading Staples setup" })).toBeVisible();
    await expectAccessible(page, "authenticated setup loading");
    release();
    // The setup gate leaves its loading state exactly when the setup action answers, so the held page has finished with it.
    await expect(page.getByRole("region", { name: "Loading Staples setup" })).toHaveCount(0);
    await page.unroute("**/*");
    // Only the setup check fails: the non-blocking notice leaves the dashboard usable. It is matched by its action id, not as
    // "the first POST to /": the dashboard's own actions go to the same path, and one of them arriving first took the abort (#256).
    const setupAction = serverActionId(
      "src/features/trips/trip-actions.ts",
      "getStaplesSetupAction",
    );
    let aborted = false;
    await page.route("**/*", (route) => {
      if (!aborted && route.request().headers()["next-action"] === setupAction) {
        aborted = true;
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto("/");
    await expect(page.getByRole("status", { name: "Staples setup unavailable" })).toContainText(
      "Couldn’t check your Staples setup.",
    );
    // The fixed clock gives the Home a next trip, so its heading is the screen-reader-only "Trips".
    await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeAttached();
    // #377: the redesigned Home's countdown badge falls short of 4.5:1; nothing else is exempt.
    await expectAccessible(page, "authenticated setup check error", {
      disable: ["color-contrast"],
    });
  });

  test("review after a change took the trip out of Ready", async ({ page }) => {
    await openDashboard(page);
    await openPastAndArchive(page);
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

test.describe("design's known items", DEVICE, () => {
  test("the error chip stays on one line", async ({ page }) => {
    await openDashboard(page);
    await page.route("**/*", (route) =>
      route.request().method() === "POST" ? route.abort("failed") : route.continue(),
    );
    await chooseFromMenu(page, "San Diego", "Archive");
    const chip = page.getByRole("button", { name: "Not saved, retry" });
    await expect(chip).toBeVisible();
    await page.unroute("**/*");
    // One line of 12px text plus padding: well under two lines.
    expect((await chip.boundingBox())!.height).toBeLessThan(60);
  });

  test("group labels are the same size as field labels", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
    await openEditor(page, "sunglasses");
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
    await planATrip(page);
    await pickPlace(page, "lon", /England/);
    await toWhen(page);
    for (const label of ["Leave", "Return"]) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveAccessibleDescription(/Return cannot be before departure/);
      // The notice is the second description: it is empty until a date is moved.
      expect(((await input.getAttribute("aria-describedby")) ?? "").split(" ")).toHaveLength(2);
    }
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
