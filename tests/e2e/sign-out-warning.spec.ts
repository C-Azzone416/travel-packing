import { expect, test, type Locator, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import {
  accountOutboxDatabases,
  connectFeedback,
  fakeFramebriar,
  forgetFeedbackEnrollment,
  goToTrips,
  openSettingsFromNav,
} from "./helpers/feedback";

// The warning before Sign out when feedback is still waiting on this device (#325, design's spec). Real app, real SDK outbox; the
// feedback service is the local fake and is "down", so the reports can only wait. The layout checks use overlap and line counts, not
// row heights, in every state that changes the sheet's width or height, at 320, 390, 659, 660, 768 and 1280.
const WIDTHS = [320, 390, 659, 660, 768, 1280] as const;
const TITLE = "Feedback hasn’t sent yet";

test.beforeEach(async ({}, testInfo) => {
  await fakeFramebriar.reset();
  await forgetFeedbackEnrollment(`e2e-${ownerEmailFor(testInfo.project.name)}`);
});

async function withWaitingReports(page: Page, count: number) {
  await signInAsOwner(page);
  await openSettingsFromNav(page);
  await connectFeedback(page);
  await goToTrips(page);
  await fakeFramebriar.setOffline(true);
  for (let n = 1; n <= count; n++) {
    await page.locator(".feedback-button").click();
    const sheet = page.getByRole("dialog", { name: "Send feedback" });
    // Playwright's WebKit cannot store a picture in IndexedDB, so on the phone the saved report is notes-only.
    if (test.info().project.name === "phone")
      await sheet.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
    await sheet.getByLabel("What happened?").fill(`A synthetic note number ${n}`);
    await sheet.getByRole("button", { name: "Send" }).click();
    await expect(sheet.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
  }
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" });
const openFromNav = async (page: Page) => {
  await nav(page).getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("dialog", { name: TITLE })).toBeVisible();
};

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, r: r.right, b: r.bottom };
    };
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const buttons = [...dialog.querySelectorAll<HTMLElement>(".modal-actions .button")];
    return {
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialog: rect(dialog),
      dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
      // Every box is read before anything scrolls; the hit test then scrolls each button into view in turn.
      buttons: buttons
        .map((el) => ({ el, snapshot: rect(el) }))
        .map(({ el, snapshot }) => {
          const style = getComputedStyle(el);
          const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
          const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
          const box = el.getBoundingClientRect();
          el.scrollIntoView({ block: "nearest" });
          const seen = el.getBoundingClientRect();
          const centre = document.elementFromPoint(
            seen.x + seen.width / 2,
            seen.y + seen.height / 2,
          );
          return {
            text: el.textContent ?? "",
            box: snapshot,
            lines: Math.round((box.height - pad - 2) / line),
            clipped: el.scrollWidth > el.clientWidth + 1,
            onTop: centre === el || el.contains(centre),
          };
        }),
    };
  });
}

const intersects = (a: Box, b: Box) =>
  a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

async function expectSound(page: Page, width: number, where: string) {
  const m = await measure(page);
  expect(m.scrollX, `no sideways scroll ${where}`).toBeLessThanOrEqual(0);
  expect(m.dialog.x, `dialog left ${where}`).toBeGreaterThanOrEqual(0);
  expect(m.dialog.r, `dialog right ${where}`).toBeLessThanOrEqual(m.vw + 0.5);
  expect(m.dialog.y, `dialog top ${where}`).toBeGreaterThanOrEqual(0);
  expect(m.dialog.b, `dialog bottom ${where}`).toBeLessThanOrEqual(m.vh + 0.5);
  for (const [i, a] of m.buttons.entries()) {
    expect(a.lines, `${a.text} line count ${where}`).toBeLessThanOrEqual(2);
    expect(a.clipped, `${a.text} clipped ${where}`).toBe(false);
    expect(
      a.onTop,
      `${a.text} is the top element (the bottom nav does not show through) ${where}`,
    ).toBe(true);
    expect(a.box.r, `${a.text} inside dialog ${where}`).toBeLessThanOrEqual(m.dialog.r + 0.5);
    // When the sheet scrolls inside itself (200% text on a short phone) the footer is reached by scrolling, not seen at once.
    if (!m.dialogScrolls)
      expect(a.box.b, `${a.text} inside dialog ${where}`).toBeLessThanOrEqual(m.dialog.b + 0.5);
    for (const b of m.buttons.slice(i + 1))
      expect(intersects(a.box, b.box), `${a.text} overlaps ${b.text} ${where}`).toBe(false);
  }
  const [anyway, stay, send] = m.buttons;
  if (width < 660) {
    // A bottom sheet: stacked, full width, Send now on top, then Stay, then Sign out anyway.
    for (const button of m.buttons)
      expect(Math.abs(button.box.x - m.buttons[0].box.x), `stacked ${where}`).toBeLessThanOrEqual(
        1,
      );
    expect(stay.box.y, `Stay is above Sign out anyway ${where}`).toBeLessThan(anyway.box.y);
    if (send) expect(send.box.y, `Send now is on top ${where}`).toBeLessThan(stay.box.y);
    for (const button of m.buttons)
      expect(button.box.b - button.box.y, `tap height ${where}`).toBeGreaterThanOrEqual(43.5);
  } else if (!m.dialogScrolls && m.buttons.every((b) => Math.abs(b.box.y - anyway.box.y) < 2)) {
    // A centered dialog: one row, left to right Sign out anyway, Stay signed in, Send now.
    expect(anyway.box.x).toBeLessThan(stay.box.x);
    if (send) expect(stay.box.x).toBeLessThan(send.box.x);
  }
}

async function eachWidth(page: Page, state: string, check: () => Promise<void> = async () => {}) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 660 ? 700 : 800 });
    await check();
    await expectSound(page, width, `${state} at ${width}px`);
  }
}

/** The test's own 200% text: the sheet must still keep every label whole and every button reachable. */
async function largeText(page: Page) {
  await page.addStyleTag({
    content:
      ".modal h2 { font-size: 44px !important } .modal p, .modal .button { font-size: 28px !important }",
  });
  await expect
    .poll(() =>
      page.locator(".modal h2").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    )
    .toBeGreaterThanOrEqual(40);
}

test(
  "one report and many: the sheet fits at every width, Send now shown",
  DEVICE,
  async ({ page }) => {
    await withWaitingReports(page, 3);
    await openFromNav(page);
    const dialog = page.getByRole("dialog", { name: TITLE });
    await expect(
      dialog.getByText("3 reports haven’t sent yet. Signing out deletes them from this device."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send now" })).toBeVisible();
    await eachWidth(page, "3 reports + Send now");
    await largeText(page);
    await eachWidth(page, "3 reports + Send now at 200% text");
  },
);

test(
  "one report, Send now hidden when the browser is offline, and focus rules",
  DEVICE,
  async ({ page }) => {
    await withWaitingReports(page, 1);
    const signOutButton = nav(page).getByRole("button", { name: "Sign out" });
    await signOutButton.click();
    const dialog = page.getByRole("dialog", { name: TITLE });
    await expect(
      dialog.getByText("1 report hasn’t sent yet. Signing out deletes it from this device."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Stay signed in" })).toBeFocused();
    await eachWidth(page, "1 report + Send now");
    await page.context().setOffline(true);
    await expect(
      dialog.getByText("You’re offline, so these can’t be sent right now."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send now" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Stay signed in" })).toBeFocused();
    await eachWidth(page, "1 report, offline (Send now hidden)");
    await largeText(page);
    await eachWidth(page, "1 report, offline, 200% text");
    // Escape is "Stay signed in": nothing is cleared, and focus goes back to the Sign out button.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(signOutButton).toBeFocused();
    expect(await accountOutboxDatabases(page)).toHaveLength(1);
    await page.context().setOffline(false);
  },
);

test("sending, then a partial failure with the count and Try again", DEVICE, async ({ page }) => {
  await withWaitingReports(page, 2);
  await openFromNav(page);
  const dialog = page.getByRole("dialog", { name: TITLE });
  // Hold the send so the "Sending…" state can be measured, then let it fail (the service is down).
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/api/feedback/reports", async (route) => {
    await held;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await dialog.getByRole("button", { name: "Send now" }).click();
  // The SDK skips a report that is still inside its own retry delay, so the send can end at once (always in WebKit, after the
  // failed first try), so the held "Sending…" state is measured on desktop only.
  const sending = dialog.getByRole("button", { name: "Sending…" });
  if (test.info().project.name === "desktop") {
    await expect(sending).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("status")).toHaveText("Sending your reports…");
    await eachWidth(page, "sending");
  }
  release();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeFocused({ timeout: 20_000 });
  await expect(dialog.getByRole("alert")).toContainText("Some reports couldn’t be sent yet.");
  await expect(dialog.getByText(/^2 reports haven’t sent yet/)).toBeVisible();
  await eachWidth(page, "partial failure + Try again");
  await largeText(page);
  await eachWidth(page, "partial failure + Try again at 200% text");
});

test(
  "Settings sign-out warns the same way, Sign out anyway deletes the reports and signs out",
  DEVICE,
  async ({ page }) => {
    await withWaitingReports(page, 1);
    await openSettingsFromNav(page);
    const signOutButton: Locator = page.getByRole("main").getByRole("button", { name: "Sign out" });
    await signOutButton.click();
    const dialog = page.getByRole("dialog", { name: TITLE });
    await expect(dialog).toBeVisible();
    await eachWidth(page, "from Settings");
    await page.keyboard.press("Escape");
    await expect(signOutButton).toBeFocused();
    await signOutButton.click();
    await dialog.getByRole("button", { name: "Sign out anyway" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(await accountOutboxDatabases(page)).toEqual([]);
  },
);

test("nothing unsent: Sign out stays one tap, no sheet", async ({ page }) => {
  await signInAsOwner(page);
  await nav(page).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
