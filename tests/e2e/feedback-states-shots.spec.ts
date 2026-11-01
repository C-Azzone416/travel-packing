import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, SECOND_EMAIL, signIn, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import {
  connectFeedback,
  fakeFramebriar,
  forgetFeedbackEnrollment,
  goToTrips,
  openSettingsFromNav,
  signOutDiscardingUnsent,
} from "./helpers/feedback";

// Rendered screenshots of every account-scoped feedback state for design review (#260). Run with FEEDBACK_STATE_SHOTS=<folder>; without it
// these are skipped, so the normal run neither writes files nor pays for them. The states the server decides are shown by answering the
// status route with each state (the screen reads nothing else); the saved-report and sign-out states are the real flow.
const SHOTS = process.env.FEEDBACK_STATE_SHOTS;
const THEMES = ["base", "ocean", "terracotta", "violet"] as const;
const WIDTHS = [390, 1280] as const;
const FAR = "2099-01-01T00:00:00.000Z";
const SERVER_STATES = [
  { name: "expired", status: "expired", expiresAt: "2020-01-01T00:00:00.000Z", key: true },
  { name: "ended", status: "revoked", expiresAt: FAR, key: true },
  { name: "switched-off", status: "disabled", expiresAt: FAR, key: true },
  { name: "needs-reconnect", status: "needs_reconnect", expiresAt: null, key: true },
  { name: "unavailable", status: "unavailable", expiresAt: null, key: true },
  { name: "finish-connecting", status: "not-connected", expiresAt: null, key: true, pending: true },
] as const;

test.skip(!SHOTS, "set FEEDBACK_STATE_SHOTS=<folder> to render the design screenshots");

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`${theme} ${width}: every account-scoped feedback state`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const tag = `${theme}-${width}`;
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await fakeFramebriar.reset();
      const owner = ownerEmailFor(testInfo.project.name);
      await forgetFeedbackEnrollment(`e2e-${owner}`);
      await forgetFeedbackEnrollment(`e2e-${SECOND_EMAIL}`);
      await signInAsOwner(page);
      await setOwnerAppearance(`e2e-${owner}`, theme);
      await page
        .context()
        .addCookies([{ name: "appearance", value: theme, url: "http://localhost:3100" }]);

      await openSettingsFromNav(page);
      await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
      await shot(page, `${tag}-settings-not-connected`);
      await connectFeedback(page);
      await shot(page, `${tag}-settings-connected`);

      // A report that can only wait on this device.
      await goToTrips(page);
      await fakeFramebriar.failNext(
        "report",
        { kind: "status", status: 429, retryAfterSeconds: 120 },
        5,
      );
      await page.getByRole("button", { name: "Send feedback" }).click();
      const dialog = page.getByRole("dialog", { name: "Send feedback" });
      await dialog.getByLabel("What happened?").fill("A report that waits on this device");
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
      await shot(page, `${tag}-sheet-saved`);
      await dialog.getByRole("button", { name: "Done" }).click();
      await openSettingsFromNav(page);
      await expect(page.getByText("1 report waiting to send on this device.")).toBeVisible();
      // The service answered "too many for now": the report waits, and Settings says so (quota-limited).
      await expect(page.getByText("Feedback is limited for a moment.")).toBeVisible({
        timeout: 30_000,
      });
      await shot(page, `${tag}-settings-waiting-report-quota-limited`);
      await page.getByRole("button", { name: "Delete unsent reports" }).click();
      await shot(page, `${tag}-settings-delete-unsent-confirm`);
      await page.getByRole("button", { name: "Keep them" }).click();

      // The stubbed answers carry this account's real outbox key (another key would, correctly, sweep its waiting reports away).
      const KEY = (
        await page.evaluate(() => fetch("/api/feedback/enrollment").then((r) => r.json()))
      ).outboxKey as string;

      // The states the server decides, on Settings and as the notice on Trips.
      for (const state of SERVER_STATES) {
        await page.route("**/api/feedback/enrollment", (route) =>
          route.request().method() === "GET"
            ? route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                  v: 1,
                  status: state.status,
                  expiresAt: state.expiresAt,
                  redemption: "pending" in state ? "pending" : "none",
                  hasRecord: state.status !== "not-connected" || "pending" in state,
                  outboxKey: KEY,
                }),
              })
            : route.fallback(),
        );
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Send feedback to the developer" }),
        ).toBeVisible();
        await page.waitForTimeout(400);
        await shot(page, `${tag}-settings-${state.name}`);
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Trips" })
          .click();
        await page.waitForTimeout(400);
        await shot(page, `${tag}-trips-${state.name}`);
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Settings" })
          .click();
        await expect(
          page.getByRole("heading", { name: "Send feedback to the developer" }),
        ).toBeVisible();
        await page.unroute("**/api/feedback/enrollment");
      }

      // Offline: this browser has no network.
      await page.context().setOffline(true);
      await expect(page.getByText("You’re offline.")).toBeVisible();
      await shot(page, `${tag}-settings-offline`);
      await page.context().setOffline(false);

      // Sign-out clears this account's unsent report; the next account on the same browser starts clean.
      await expect(
        page.getByRole("heading", { name: "Send feedback to the developer" }),
      ).toBeVisible();
      await signOutDiscardingUnsent(page);
      await shot(page, `${tag}-signed-out`);
      await signIn(page, SECOND_EMAIL);
      await openSettingsFromNav(page);
      await shot(page, `${tag}-second-account-settings`);
    });
  }
}
