import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { ageEnrollment, connectFeedback, fakeFramebriar, openSettings } from "./helpers/feedback";

// Rendered screenshots for design's review of the Settings Disconnect results (#304, the #261 spec section 3). Run with
//   DISCONNECT_SHOTS=<folder> npx playwright test tests/e2e/feedback-disconnect-shots.spec.ts --project=desktop
// (build and serve as for any e2e run; port 3115 for the app when running next to other agents). Without the variable these are
// skipped. Every result is shown at desktop 1280, phone 390 and phone 320, as a picture of the whole Feedback card, and the test also
// measures what a picture cannot prove: the message's line count, and that nothing overflows sideways or is clipped.
//   - REAL: ended, nothing, erased_unrevocable (no date), uncertain, pending, offline are produced by the real app and database.
//   - SYNTHETIC (the response is answered by the browser): partial and unavailable (they need a database fault), and
//     erased_unrevocable WITH a date (it needs a key that vanishes between status and disconnect). The words are the app's own.
const SHOTS = process.env.DISCONNECT_SHOTS;
const WIDTHS = [1280, 390, 320] as const;
const DISCONNECT = "**/api/feedback/enrollment/disconnect";

test.skip(!SHOTS, "set DISCONNECT_SHOTS=<folder> to render the design screenshots");

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function pressDisconnect(page: Page) {
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("group", { name: "Disconnect feedback" })
    .getByRole("button", { name: "Disconnect" })
    .click();
}

const answer = (status: number, body: Record<string, unknown>) => (page: Page) =>
  page.route(DISCONNECT, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ v: 1, ...body }),
    }),
  );

interface Case {
  label: string;
  /** Gets the account into the state the result comes from, ending on Settings with Disconnect on screen. */
  arrange: (page: Page) => Promise<void>;
  /** Region the result lands in. */
  region: "status" | "alert";
}

async function connected(page: Page) {
  await openSettings(page);
  await connectFeedback(page);
}

const CASES: Case[] = [
  { label: "1-ended", region: "status", arrange: connected },
  {
    label: "2-nothing-expired-record",
    region: "status",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "expired");
      await page.reload();
      await expect(page.locator(".status-pill", { hasText: "Expired" })).toBeVisible();
    },
  },
  {
    label: "3-erased-unrevocable-no-date",
    region: "status",
    arrange: async (page) => {
      await connected(page);
      await ageEnrollment(ownerId(), "unreadable");
      await page.reload();
      await expect(page.locator(".status-pill", { hasText: "Needs invitation" })).toBeVisible();
    },
  },
  {
    label: "3b-erased-unrevocable-with-date-SYNTHETIC",
    region: "status",
    arrange: async (page) => {
      await connected(page);
      await answer(200, { status: "not-connected", outcome: "erased_unrevocable", revoked: false })(
        page,
      );
    },
  },
  {
    label: "4-partial-SYNTHETIC",
    region: "alert",
    arrange: async (page) => {
      await connected(page);
      await answer(503, { error: "PARTIAL" })(page);
    },
  },
  {
    label: "5-unavailable-SYNTHETIC",
    region: "alert",
    arrange: async (page) => {
      await connected(page);
      await answer(503, { error: "UNAVAILABLE" })(page);
    },
  },
  {
    label: "6-uncertain",
    region: "alert",
    arrange: async (page) => {
      await connected(page);
      await fakeFramebriar.failNext("disconnect", { kind: "network" });
    },
  },
  {
    label: "7-pending",
    region: "alert",
    arrange: async (page) => {
      await openSettings(page);
      await fakeFramebriar.failNext("redeem", { kind: "network" });
      await page.getByLabel("Invitation").fill(await fakeFramebriar.issueInvitation());
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByText(/may have been used/)).toBeVisible();
    },
  },
  {
    label: "8-offline",
    region: "alert",
    arrange: async (page) => {
      await connected(page);
      await page.route(DISCONNECT, (route) => route.abort("failed"));
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
      const card = page.locator("#settings-feedback");
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${SHOTS}/${width}-${item.label}-before.png` });

      await pressDisconnect(page);
      const region = card.locator(`div.tiny[role="${item.region}"]`).filter({ hasText: /./ });
      await expect(region).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${SHOTS}/${width}-${item.label}-after.png` });
      await page.screenshot({ path: `${SHOTS}/${width}-${item.label}-after-viewport.png` });

      // What a picture cannot prove: no sideways overflow, nothing clipped, and how many lines the message takes.
      const measured = await region.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const lineHeight =
          Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
        const cardNode = node.closest("#settings-feedback") as HTMLElement;
        return {
          lines: Math.round(box.height / lineHeight),
          messageOverflow: node.scrollWidth - node.clientWidth,
          cardOverflow: cardNode.scrollWidth - cardNode.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          insideCard: box.right <= cardNode.getBoundingClientRect().right + 0.5,
        };
      });
      test.info().annotations.push({ type: "message-lines", description: String(measured.lines) });
      expect(measured.messageOverflow).toBeLessThanOrEqual(0);
      expect(measured.cardOverflow).toBeLessThanOrEqual(0);
      expect(measured.pageOverflow).toBeLessThanOrEqual(0);
      expect(measured.insideCard).toBe(true);
    });
  }
}
