import { expect, test } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";

// Settings and the truthful save states (#19), against the real app and database.
const NOW = new Date("2026-10-16T12:00:00");

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

test("Account shows who is signed in, and Sign out goes straight through to sign-in", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  await expect(page.getByText(ownerEmailFor(testInfo.project.name))).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  // Signed out for real: the app routes send the visitor back to sign-in.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("nothing is claimed saved before anything was, and 'Last saved' appears after a real save", async ({
  page,
}) => {
  await openSettings(page);
  await expect(page.getByText("Nothing saved yet this visit.")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  await page.getByRole("button", { name: "Archive: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await page.getByRole("link", { name: "Saved" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
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
  await page.getByRole("button", { name: "Archive: San Diego" }).click();
  const chip = page.getByRole("button", { name: "Couldn't save, retry" });
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Saved" })).toHaveCount(0);

  // The chip explains before it does anything.
  await chip.click();
  const sheet = page.getByRole("dialog", { name: "Couldn’t save" });
  await expect(sheet.getByText(/Your last change hasn’t been saved/)).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-settings-error-sheet.png`,
  });
  await sheet.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: "Couldn't save, retry" })).toBeVisible();

  // Settings tells the same truth.
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByText(/Your last change hasn’t been saved/).first()).toBeVisible();
  await expect(page.getByText("Everything you changed is saved.")).toHaveCount(0);
  await expect(page.getByText("Nothing saved yet this visit.")).toBeVisible();
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
  await page.getByRole("button", { name: "Couldn't save, retry" }).click();
  await page
    .getByRole("dialog", { name: "Couldn’t save" })
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
});

test("no Offline, Waiting or simulated-sync copy anywhere on Settings, at both sizes", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/offline|waiting|simulat|prototype|sample|reset/i);
  if (testInfo.project.name === "phone") {
    for (const control of [
      page.getByRole("button", { name: "Sign out" }),
      page.getByRole("link", { name: /Saved|Saving/ }),
    ]) {
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
});
