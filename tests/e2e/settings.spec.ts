import { expect, test } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE } from "./helpers/device";
import { expectAccessible } from "./helpers/a11y";

// Settings and the truthful save states (#19), against the real app and database.
const NOW = new Date("2026-10-16T12:00:00");

/** The failed-save sheet's description at one width: at most three lines, inside the dialog, and "it." not alone on its last line. */
async function expectSheetCopyFits(
  page: import("@playwright/test").Page,
  sheet: import("@playwright/test").Locator,
  width: number,
) {
  await page.setViewportSize({ width, height: 800 });
  const description = sheet.getByText("Your change is still on screen. Retry to save it.");
  await expect(description).toBeVisible();
  const layout = await description.evaluate((el) => {
    const text = el.firstChild as Text;
    const firstRectOf = (needle: string) => {
      const start = text.data.lastIndexOf(needle);
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + needle.length);
      return range.getClientRects()[0];
    };
    const all = document.createRange();
    all.selectNodeContents(el);
    const lineTops = new Set(Array.from(all.getClientRects(), (rect) => Math.round(rect.top)));
    return {
      lineCount: lineTops.size,
      saveAndItShareLine:
        Math.round(firstRectOf("save").top) === Math.round(firstRectOf("it.").top),
    };
  });
  const box = await description.boundingBox();
  const dialog = await sheet.boundingBox();
  if (!box || !dialog) throw new Error("the sheet or its description has no layout box");
  expect(layout.lineCount, `description lines at ${width}px`).toBeLessThanOrEqual(3);
  expect(layout.saveAndItShareLine, `"it." wrapped away from "save" at ${width}px`).toBe(true);
  expect(box.x).toBeGreaterThanOrEqual(dialog.x);
  expect(box.y).toBeGreaterThanOrEqual(dialog.y);
  expect(box.x + box.width).toBeLessThanOrEqual(dialog.x + dialog.width);
  expect(box.y + box.height).toBeLessThanOrEqual(dialog.y + dialog.height);
  if (width === 320) {
    await sheet.screenshot({ path: "test-results/screenshots/settings-error-sheet-320.png" });
  }
}

async function openSettings(page: import("@playwright/test").Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("on a wide screen the heading and lede share the cards' column; a phone keeps its margins (#178)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page);
  const left = async (locator: import("@playwright/test").Locator) =>
    Math.round((await locator.boundingBox())!.x);
  const card = page.locator(".settings-grid > *").first();
  const heading = page.getByRole("heading", { name: "Settings", level: 1 });
  expect(await left(heading)).toBe(await left(card));
  expect(await left(page.getByText("Your account and how saving is going."))).toBe(
    await left(card),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.locator(".settings-head").evaluate((el) => getComputedStyle(el).marginLeft),
  ).toBe("2px");
});

test("Account shows who is signed in, and Sign out goes straight through to sign-in", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  await expect(page.getByText(ownerEmailFor(testInfo.project.name))).toBeVisible();
  // The Account card's button (the nav has one too, #117).
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  // Signed out for real: the app routes send the visitor back to sign-in.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
});

test(
  "Close account requires explicit destructive confirmation in an accessible keyboard-contained sheet",
  DEVICE,
  async ({ page }) => {
    await openSettings(page);
    const opener = page.getByRole("main").getByRole("button", { name: "Close account" });
    const dialog = page.getByRole("dialog", { name: "Close your account?" });
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Current password")).toBeFocused();
    const focusIsInside = () => dialog.evaluate((node) => node.contains(document.activeElement));
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIsInside(), `Tab ${press + 1} stays in the dialog`).toBe(true);
    }
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusIsInside(), `Shift+Tab ${press + 1} stays in the dialog`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByLabel("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await expect(dialog.getByLabel("Type DELETE to confirm")).toBeVisible();
    await expectAccessible(page, "close account confirmation sheet");
    const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of [
      dialog.getByRole("button", { name: "Cancel" }),
      dialog.getByRole("button", { name: "Close account permanently" }),
    ]) {
      expect(Math.round((await button.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  },
);

test("nothing is claimed saved before anything was, and 'Last saved' appears after a real save", async ({
  page,
}) => {
  await openSettings(page);
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  await chooseFromMenu(page, "San Diego", "Archive");
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // "Saved" holds for about 2s after a write, then the card settles on "Up to date" with the time.
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^Last saved \d{1,2}:\d{2}\s?[AP]M$/)).toBeVisible();
});

test("a failed save shows Error everywhere, never claims Saved, and Retry recovers", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  const isAction = (request: { method(): string; url(): string }) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/";
  await page.route("**/*", (route) =>
    isAction(route.request()) ? route.abort("failed") : route.continue(),
  );
  await chooseFromMenu(page, "San Diego", "Archive");
  const chip = page.getByRole("button", { name: "Not saved, retry" });
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);

  // The chip explains before it does anything.
  await chip.click();
  const sheet = page.getByRole("dialog", { name: "Couldn’t save" });
  await expect(sheet.getByText("Your change is still on screen. Retry to save it.")).toBeVisible();
  // At 320 and 390 the description is at most three lines, sits inside the dialog, and never leaves "it." alone on its last
  // line (the non-breaking space between "save" and "it." keeps them together).
  const viewport = page.viewportSize();
  for (const width of [320, 390]) {
    await expectSheetCopyFits(page, sheet, width);
  }
  if (viewport) await page.setViewportSize(viewport);
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-settings-error-sheet.png`,
  });
  await sheet.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: "Not saved, retry" })).toBeVisible();

  // Settings tells the same truth.
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Your change is still on screen.")).toBeVisible();
  await expect(page.getByText("Up to date", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByText(/^Last saved/)).toHaveCount(0);
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-settings-error.png`,
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();

  // Network back: Retry stores the change, and only then does it say Saved.
  await page.unroute("**/*");
  await page.getByRole("button", { name: "Not saved, retry" }).click();
  await page
    .getByRole("dialog", { name: "Couldn’t save" })
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
});

test(
  "no Offline, Waiting or simulated-sync copy anywhere on Settings, at both sizes",
  DEVICE,
  async ({ page }, testInfo) => {
    await openSettings(page);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/offline|waiting|simulat|prototype|sample|reset/i);
    if (testInfo.project.name === "phone") {
      for (const control of [page.getByRole("main").getByRole("button", { name: "Sign out" })]) {
        expect(Math.round((await control.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-settings.png`,
      fullPage: true,
    });
  },
);

// Field Ledger themes (#142): the choice applies at once, survives reload and navigation, and is account-level.
test("the Theme choice applies at once and persists across reload, navigation and a device with no cookie", async ({
  page,
  context,
}) => {
  await openSettings(page);
  const html = page.locator("html");
  const accent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
  await expect(html).toHaveAttribute("data-appearance", "base");
  expect(await accent()).toBe("#a64a39");

  await page.getByRole("radio", { name: /Deep Ocean/ }).check();
  await expect(html).toHaveAttribute("data-appearance", "ocean");
  expect(await accent()).toBe("#2d6674");
  await expect(page.getByText("Current theme: Deep Ocean")).toBeVisible();
  // Saved for real: wait for the "Last saved" proof before leaving.
  await expect(page.getByText(/^Last saved /)).toBeVisible();

  await page.reload();
  await expect(html).toHaveAttribute("data-appearance", "ocean");
  await expect(page.getByRole("radio", { name: /Deep Ocean/ })).toBeChecked();

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Staples" })
    .click();
  await expect(html).toHaveAttribute("data-appearance", "ocean");

  // A new device has the session but no cookie mirror: the account's choice still wins.
  const cookies = await context.cookies();
  await context.clearCookies({ name: "appearance" });
  expect((await context.cookies()).length).toBe(cookies.length - 1);
  await page.goto("/settings");
  await expect(html).toHaveAttribute("data-appearance", "ocean");
});
