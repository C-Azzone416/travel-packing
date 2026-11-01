import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { ageEnrollment, connectFeedback, fakeFramebriar, openSettings } from "./helpers/feedback";

// Rendered screenshots for design's review of the Close account sheet (#261, the spec's section 8). Run with
//   CLOSE_ACCOUNT_SHOTS=<folder> npx playwright test tests/e2e/feedback-close-account-shots.spec.ts --project=desktop
// (app port 3115 next to other agents: E2E_PORT=3115, and add E2E_PREBUILT=1 when it is already built). Without the variable these
// are skipped. Every state is shown at desktop 1280, phone 390 and phone 320 as a picture of the whole page and of the dialog, and the
// test also measures what a picture cannot prove: the live message's line count, no sideways overflow, buttons inside the dialog and not
// overlapping, and (during the guard return) no password anywhere in the page. Nothing here closes an account.
//   - REAL: every state comes from the real app and database, except those labelled SYNTHETIC, where the browser answers the
//     disconnect call because the state needs a fault the synthetic stack cannot make: partial, unavailable, signed out, and
//     erased_unrevocable WITH a date (it needs a key that vanishes between status and disconnect).
const SHOTS = process.env.CLOSE_ACCOUNT_SHOTS;
const WIDTHS = [1280, 390, 320] as const;
const DISCONNECT = "**/api/feedback/enrollment/disconnect";
const STATUS = "**/api/feedback/enrollment";

test.skip(!SHOTS, "set CLOSE_ACCOUNT_SHOTS=<folder> to render the design screenshots");

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

const answer = (page: Page, status: number, body: Record<string, unknown>) =>
  page.route(DISCONNECT, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ v: 1, ...body }),
    }),
  );

async function connected(page: Page) {
  await openSettings(page);
  await connectFeedback(page);
}

async function openSheet(page: Page, name = "Disconnect feedback first") {
  await page.getByRole("main").getByRole("button", { name: "Close account" }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible();
}

async function saveUnsentReport(page: Page) {
  await fakeFramebriar.setOffline(true);
  await page.locator(".feedback-send-action").click();
  const sheet = page.getByRole("dialog", { name: "Send feedback" });
  await sheet.getByLabel("What happened?").fill("A synthetic note that waits on this device");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await fakeFramebriar.setOffline(false);
}

const disconnect = (page: Page) =>
  page
    .getByRole("dialog")
    .getByRole("button", { name: /^(Disconnect|Try again)$/ })
    .click();

interface Case {
  label: string;
  /** Gets to the state to photograph, with the sheet open on it. */
  arrange: (page: Page) => Promise<void>;
}

async function step1Connected(page: Page) {
  await connected(page);
  await openSheet(page);
}

async function toStep2(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Close your account?" })).toBeVisible();
}

const CASES: Case[] = [
  { label: "01-step1-connected", arrange: step1Connected },
  {
    label: "02-step1-connected-with-unsent",
    arrange: async (page) => {
      await connected(page);
      await saveUnsentReport(page);
      await openSheet(page);
      await expect(page.getByText(/1 unsent report on this device/)).toBeVisible();
    },
  },
  {
    label: "03-step1-loading",
    arrange: async (page) => {
      await connected(page);
      // The status answer is held, so the sheet is open on "Checking your feedback access…".
      await page.route(STATUS, async (route) => {
        if (route.request().method() === "GET") await new Promise((done) => setTimeout(done, 6000));
        await route.fallback();
      });
      await page.reload();
      await page.getByRole("main").getByRole("button", { name: "Close account" }).click();
      await expect(
        page.getByRole("dialog").getByText("Checking your feedback access…"),
      ).toBeVisible();
    },
  },
  {
    label: "04a-step1-record-expired",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "expired");
      await page.reload();
      await openSheet(page);
      await expect(page.getByRole("dialog").getByText("Expired")).toBeVisible();
    },
  },
  {
    label: "04b-step1-record-needs-invitation",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "unreadable");
      await page.reload();
      await openSheet(page);
      await expect(page.getByRole("dialog").getByText("Needs invitation")).toBeVisible();
    },
  },
  {
    label: "04c-step1-record-pending-connection",
    arrange: async (page) => {
      await openSettings(page);
      await fakeFramebriar.failNext("redeem", { kind: "network" });
      await page.getByLabel("Invitation").fill(await fakeFramebriar.issueInvitation());
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByText(/may have been used/)).toBeVisible();
      await openSheet(page);
      await expect(page.getByRole("dialog").getByText("Not finished")).toBeVisible();
    },
  },
  {
    label: "05a-result-ended",
    arrange: async (page) => {
      await step1Connected(page);
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Continue" }),
      ).toBeFocused();
    },
  },
  {
    label: "05b-result-nothing-expired-record",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "expired");
      await page.reload();
      await openSheet(page);
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Continue" }),
      ).toBeVisible();
    },
  },
  {
    label: "05c-result-erased-unrevocable-no-date",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "unreadable");
      await page.reload();
      await openSheet(page);
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Continue" }),
      ).toBeVisible();
    },
  },
  {
    label: "05d-result-erased-unrevocable-with-date-SYNTHETIC",
    arrange: async (page) => {
      await step1Connected(page);
      await answer(page, 200, {
        status: "not-connected",
        outcome: "erased_unrevocable",
        revoked: false,
      });
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Continue" }),
      ).toBeVisible();
    },
  },
  {
    label: "05e-result-partial-SYNTHETIC",
    arrange: async (page) => {
      await step1Connected(page);
      await answer(page, 503, { error: "PARTIAL" });
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Try again" }),
      ).toBeVisible();
    },
  },
  {
    label: "05f-result-unavailable-SYNTHETIC",
    arrange: async (page) => {
      await step1Connected(page);
      await answer(page, 503, { error: "UNAVAILABLE" });
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Try again" }),
      ).toBeVisible();
    },
  },
  {
    label: "05g-result-uncertain",
    arrange: async (page) => {
      await step1Connected(page);
      await fakeFramebriar.failNext("disconnect", { kind: "network" });
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Try again" }),
      ).toBeVisible();
    },
  },
  {
    label: "05h-result-pending-connection",
    arrange: async (page) => {
      await openSettings(page);
      await fakeFramebriar.failNext("redeem", { kind: "network" });
      await page.getByLabel("Invitation").fill(await fakeFramebriar.issueInvitation());
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByText(/may have been used/)).toBeVisible();
      await openSheet(page);
      await disconnect(page);
      await expect(
        page.getByRole("dialog").getByRole("button", { name: "Try again" }),
      ).toBeVisible();
    },
  },
  {
    label: "05i-result-offline",
    arrange: async (page) => {
      await step1Connected(page);
      await page.route(DISCONNECT, (route) => route.abort("failed"));
      await disconnect(page);
      await expect(
        page
          .getByRole("dialog")
          .getByRole("alert")
          .filter({ hasText: /offline/ }),
      ).toBeVisible();
    },
  },
  {
    label: "05j-result-signed-out-SYNTHETIC",
    arrange: async (page) => {
      await step1Connected(page);
      await answer(page, 401, { error: "UNAUTHENTICATED" });
      await disconnect(page);
      await expect(
        page
          .getByRole("dialog")
          .getByRole("alert")
          .filter({ hasText: /signed out/ }),
      ).toBeVisible();
    },
  },
  {
    label: "06-step1-busy",
    arrange: async (page) => {
      await step1Connected(page);
      await page.route(DISCONNECT, async (route) => {
        await new Promise((done) => setTimeout(done, 8000));
        await route.fallback();
      });
      await disconnect(page);
      await expect(page.getByRole("button", { name: "Disconnecting…" })).toBeVisible();
    },
  },
  {
    label: "07-guard-return-after-stale-sheet",
    arrange: async (page) => {
      await openSettings(page);
      await openSheet(page, "Close your account?");
      const other = await page.context().newPage();
      await other.goto("/settings");
      await connectFeedback(other);
      await other.close();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Current password").fill("synthetic-e2e-only");
      await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
      await dialog.getByRole("button", { name: "Close account permanently" }).click();
      await expect(page.getByRole("dialog", { name: "Disconnect feedback first" })).toBeVisible();
      await expect(page.getByLabel("Current password")).toHaveCount(0);
      expect(await page.content()).not.toContain("synthetic-e2e-only");
    },
  },
  {
    label: "08a-step2-after-ended",
    arrange: async (page) => {
      await step1Connected(page);
      await disconnect(page);
      await toStep2(page);
    },
  },
  {
    label: "08b-step2-after-erased-unrevocable",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "unreadable");
      await page.reload();
      await openSheet(page);
      await disconnect(page);
      await toStep2(page);
    },
  },
  {
    label: "08c-step2-no-feedback-unchanged",
    arrange: async (page) => {
      await openSettings(page);
      await openSheet(page, "Close your account?");
    },
  },
  {
    label: "08d-step2-unsent-only",
    arrange: async (page) => {
      await connected(page);
      await saveUnsentReport(page);
      await page.getByRole("button", { name: "Disconnect" }).click();
      await page
        .getByRole("group", { name: "Disconnect feedback" })
        .getByRole("button", { name: "Disconnect" })
        .click();
      await expect(page.getByText("Disconnected. Your feedback access was ended.")).toBeVisible();
      await openSheet(page, "Close your account?");
      await expect(page.getByText(/unsent report on this device will be deleted/)).toBeVisible();
    },
  },
];

for (const width of WIDTHS) {
  for (const item of CASES) {
    test(`${width}: ${item.label}`, async ({ page }) => {
      test.setTimeout(120_000);
      mkdirSync(SHOTS!, { recursive: true });
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await fakeFramebriar.reset();
      await item.arrange(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${width}-${item.label}-page.png` });
      await dialog.screenshot({ path: `${SHOTS}/${width}-${item.label}-dialog.png` });

      const measured = await dialog.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const buttons = [...node.querySelectorAll<HTMLElement>(".modal-actions .button")].map(
          (button) => button.getBoundingClientRect(),
        );
        const overlaps = buttons.some((a, i) =>
          buttons.some(
            (b, j) =>
              i < j &&
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5,
          ),
        );
        const live = [
          ...node.querySelectorAll<HTMLElement>('[role="status"],[role="alert"]'),
        ].filter((element) => (element.textContent ?? "").trim() !== "");
        const lines = live.map((element) => {
          const lineHeight =
            Number.parseFloat(getComputedStyle(element).lineHeight) ||
            Number.parseFloat(getComputedStyle(element).fontSize) * 1.4;
          return Math.round(element.getBoundingClientRect().height / lineHeight);
        });
        return {
          dialogOverflow: node.scrollWidth - node.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          buttonsInside: buttons.every(
            (button) => button.left >= box.left - 0.5 && button.right <= box.right + 0.5,
          ),
          buttonHeights: buttons.map((button) => Math.round(button.height)),
          overlaps,
          lines,
        };
      });
      test
        .info()
        .annotations.push({ type: "message-lines", description: measured.lines.join(",") });
      expect(measured.dialogOverflow).toBeLessThanOrEqual(0);
      expect(measured.pageOverflow).toBeLessThanOrEqual(0);
      expect(measured.buttonsInside).toBe(true);
      expect(measured.overlaps).toBe(false);
      for (const height of measured.buttonHeights) expect(height).toBeGreaterThanOrEqual(44);
    });
  }
}
