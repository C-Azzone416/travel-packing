import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appearanceName, type Appearance } from "../../src/domain/appearance";
import { ownerEmailFor, setupEmailFor, signIn } from "./helpers/auth";
import {
  prepareMainOnlyReadyPath,
  resetOwnerData,
  resetStaplesSetup,
  setOwnerAppearance,
  setStaplesSetupLifecycle,
} from "./helpers/database";

// Rendered review matrix for #223. It is opt-in so the ordinary suite proves behavior without writing a large
// evidence archive. STAPLES_SHOTS=<folder> captures every requested synthetic state at both review widths.
const SHOTS = process.env.STAPLES_SHOTS;
const THEMES: readonly Appearance[] = ["base", "ocean", "terracotta", "violet"];
const CELLS = THEMES.flatMap((theme) => [1280, 390].map((width) => ({ theme, width })));

const alternateTheme = (theme: Appearance): Appearance => (theme === "base" ? "ocean" : "base");

async function chooseThemeThroughSettings(page: Page, theme: Appearance) {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await page.getByRole("radio", { name: new RegExp(appearanceName(theme)) }).check();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
  await expect(page.getByText(`Current theme: ${appearanceName(theme)}`)).toBeVisible();
  await expect(page.getByText(/^Last saved /)).toBeVisible();
}

for (const { theme, width } of CELLS) {
  test(`${theme} at ${width}px: Staples setup acceptance evidence`, async ({ page, context }) => {
    test.skip(!SHOTS, "Set STAPLES_SHOTS to generate the design-review evidence matrix.");
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    mkdirSync(SHOTS!, { recursive: true });
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: join(SHOTS!, `${theme}-${width}-${name}.png`), fullPage });

    const setupEmail = setupEmailFor("desktop");
    const setupOwner = `e2e-${setupEmail}`;
    await resetStaplesSetup(setupOwner);
    await setOwnerAppearance(setupOwner, alternateTheme(theme));
    await signIn(page, setupEmail);

    // The account value is deliberately different before this selection; the target theme is chosen in Settings.
    await page.getByRole("button", { name: "Skip for now" }).click();
    await chooseThemeThroughSettings(page, theme);
    await resetStaplesSetup(setupOwner);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();

    await shot("first-use");
    await page.getByRole("checkbox", { name: "Underwear" }).focus();
    await shot("first-use-checkbox-focus", false);
    await page.getByRole("button", { name: "Skip for now" }).focus();
    await shot("first-use-skip-focus", false);

    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await page.getByRole("button", { name: /Custom item/ }).click();
    let editor = page.getByRole("dialog", { name: "Add a staple" });
    await editor.getByLabel("Item name").fill("Notebook");
    await editor.getByRole("button", { name: "Add staple" }).click();
    await shot("selected-and-custom");

    await page.getByRole("button", { name: /Custom item/ }).click();
    editor = page.getByRole("dialog", { name: "Add a staple" });
    await editor.getByRole("button", { name: "Add staple" }).click();
    await expect(editor.getByRole("alert")).toContainText("Enter a name.");
    await shot("setup-validation", false);
    await editor.getByRole("button", { name: /close/i }).click();

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
    const saveClick = page.getByRole("button", { name: "Save 2 Staples" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
    await shot("save-busy", false);
    release();
    await saveClick;
    await expect(page.locator(".staples-setup-error")).toContainText(
      "Your selections are still here.",
    );
    await expect(page.getByRole("checkbox", { name: "Underwear" })).toBeChecked();
    await shot("save-error-selections-retained");
    await page.unroute("**/*");
    await page.getByRole("button", { name: "Try save again" }).click();
    await expect(page.getByRole("heading", { name: "Your travel ledger" })).toBeVisible();

    // A migrated account keeps its existing Staples and gets an invitation to review, not fresh defaults.
    await setStaplesSetupLifecycle(setupOwner, "skipped");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Review Staples" })).toBeVisible();
    await shot("existing-user-review-invitation");
    await page.getByRole("button", { name: "Review Staples" }).click();
    const underwearRow = page
      .getByRole("checkbox", { name: "Underwear" })
      .locator("..")
      .locator("..");
    await underwearRow.getByRole("button", { name: "Edit" }).click();
    editor = page.getByRole("dialog", { name: "Edit staple" });
    await editor.getByLabel("Category").scrollIntoViewIfNeeded();
    await editor.getByRole("switch", { name: "Pack last" }).scrollIntoViewIfNeeded();
    await expect(editor.getByLabel("Category")).toBeVisible();
    await expect(editor.getByRole("group", { name: "Placement" })).toBeVisible();
    await expect(editor.getByRole("switch", { name: "Pack last" })).toBeVisible();
    await shot("editor-category-placement-pack-last", false);
    await editor.getByRole("button", { name: /close/i }).click();

    // Skipping an uninitialized empty setup produces an intentionally empty saved list plus a phone-visible reminder.
    await resetStaplesSetup(setupOwner);
    await page.goto("/");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toBeVisible();
    await shot("reminder-shown");
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.getByText("Your Staples list is intentionally empty.")).toBeVisible();
    await shot("skipped-empty-staples");

    // A separate seeded synthetic owner proves that an all-Main-list account has no toiletry-bag Ready blocker.
    await context.clearCookies();
    const seededEmail = ownerEmailFor("desktop");
    const seededOwner = `e2e-${seededEmail}`;
    await resetOwnerData(seededOwner);
    await setOwnerAppearance(seededOwner, alternateTheme(theme));
    await signIn(page, seededEmail);
    await chooseThemeThroughSettings(page, theme);
    const tripId = await prepareMainOnlyReadyPath(seededOwner);
    await page.goto("/staples");
    await expect(page.locator('[data-staple-id="notebook"]')).toBeVisible();
    await expect(page.getByText("Toiletry bag")).toHaveCount(0);
    await shot("main-list-only-staples");
    await page.goto(`/trips/${tripId}/review`);
    await expect(page.getByRole("button", { name: "I’m ready to go" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(page.getByText(/Toiletry bag (?:not ready|ready to place|is in)/)).toHaveCount(0);
    await shot("main-list-only-ready-path");
  });
}
