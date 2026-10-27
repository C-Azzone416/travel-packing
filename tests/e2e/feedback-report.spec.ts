import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import { connectedOnTrips, fakeFramebriar, openSettingsFromNav } from "./helpers/feedback";

// Capture, review and send a feedback report (#132, #133, #260), against the real app and its server, the real SDK outbox and a fake Framebriar. The report is
// saved on this device first ("Saved on this device"); the fake service later confirms it ("Received"). The flows that depend on
// the screen (the sheet, the screenshot in WebKit) run on the phone as well as on desktop.
test.beforeEach(() => fakeFramebriar.reset());

async function writeAndSend(page: Page, text: string) {
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("What happened?").fill(text);
  await dialog.getByRole("button", { name: "Send" }).click();
  return dialog;
}

test(
  "capture, save while offline, then deliver when the connection is back: Saved first, Received later",
  DEVICE,
  async ({ page, context }) => {
    await connectedOnTrips(page);

    await page.getByRole("button", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    // This is an e2e build, so the screenshot is on, ticked by default, and shown in the editor.
    await expect(
      dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("img", { name: /^Your screenshot\. Marks you draw are sent with it/ }),
    ).toBeVisible();
    await expectAccessible(page, "feedback sheet");
    await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();

    // The browser goes offline with the sheet open: the sheet says so, and Send still works.
    await context.setOffline(true);
    await expect(
      dialog.getByText("You’re offline. It will be saved here and sent when you’re back online."),
    ).toBeVisible();
    // Playwright's WebKit keeps storage in memory only and cannot store a picture in IndexedDB (real Safari can), so on the
    // phone the saved report is notes-only; the capture itself was still taken in WebKit, as the preview above shows.
    const phone = test.info().project.name === "phone";
    if (phone) {
      await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
    }
    await dialog.getByLabel("What happened?").fill("The bag count looks off");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
    expect(await fakeFramebriar.delivered()).toHaveLength(0);

    await context.setOffline(false);
    await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
      timeout: 40_000,
    });
    const all = await fakeFramebriar.delivered();
    expect(all).toHaveLength(1);
    const [delivered] = all;
    expect(delivered.report.notes).toBe("The bag count looks off");
    expect(delivered.report.scene).toBe("trips");
    if (phone) expect(delivered.mediaBytes).toBeNull();
    else expect(delivered.mediaBytes).toBeGreaterThan(0);
    // Only approved codes and numbers: no trip name, place, email or id.
    expect(JSON.stringify(delivered.report)).not.toMatch(/San Diego|@|\/trips\//);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  },
);

test("a server error is retried until the report is received", async ({ page }) => {
  await connectedOnTrips(page);
  await fakeFramebriar.failNext("report", { kind: "status", status: 503, retryAfterSeconds: 1 });

  const dialog = await writeAndSend(page, "Retry me");
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Your feedback was received. Thank you.")).toBeVisible({
    timeout: 30_000,
  });
  expect((await fakeFramebriar.counts()).report).toBeGreaterThanOrEqual(2);
  expect(await fakeFramebriar.delivered()).toHaveLength(1);
});

test("without the screenshot, only the notes are sent", async ({ page }) => {
  await connectedOnTrips(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await dialog.getByLabel("What happened?").fill("Words only");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(
    dialog.getByRole("heading", { name: /Saved on this device|Received/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await fakeFramebriar.delivered()).length, { timeout: 30_000 })
    .toBe(1);
  expect((await fakeFramebriar.delivered())[0].mediaBytes).toBeNull();
});

test("disconnecting ends the access but keeps the reports waiting on this device", async ({
  page,
}) => {
  await connectedOnTrips(page);
  // Framebriar says "come back in ten minutes" to the first send, so the report waits while the service itself is reachable.
  await fakeFramebriar.failNext("report", { kind: "status", status: 429, retryAfterSeconds: 600 });
  const dialog = await writeAndSend(page, "Keep me");
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await openSettingsFromNav(page);
  await expect(page.getByText("1 report waiting to send on this device.")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("group", { name: "Disconnect feedback" })
    .getByRole("button", { name: "Disconnect" })
    .click();
  await expect(page.getByText("Disconnected. Your feedback access was ended.")).toBeVisible();
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await page.reload();
  // Still on this device after a reload, and nothing was delivered.
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await expect(page.getByText("1 report waiting to send on this device.")).toBeVisible();
  expect(await fakeFramebriar.delivered()).toHaveLength(0);
});

test("a disconnect that cannot reach the service changes nothing and says so", async ({ page }) => {
  await connectedOnTrips(page);
  await openSettingsFromNav(page);
  await fakeFramebriar.setOffline(true);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("group", { name: "Disconnect feedback" })
    .getByRole("button", { name: "Disconnect" })
    .click();
  await expect(
    page.getByText(/couldn’t reach the service to end the access\. You’re still connected/),
  ).toBeVisible();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
  await fakeFramebriar.setOffline(false);
});

test("the Feedback button is offered on Settings (#273)", DEVICE, async ({ page }) => {
  await connectedOnTrips(page);
  await openSettingsFromNav(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();
});
