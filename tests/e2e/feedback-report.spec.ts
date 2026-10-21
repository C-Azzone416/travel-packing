import { expect, test, type Page } from "@playwright/test";
import { createFakeFramebriar } from "../../src/test/fake-framebriar";
import { routeFramebriar } from "../../src/test/fake-framebriar-playwright";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import { connectedOnTrips, openSettingsFromNav } from "./helpers/feedback";

// Capture, review and send a feedback report (#132, #133), against the real app, the real SDK and the fake service. The report is
// saved on this device first ("Saved on this device"); the fake service later confirms it ("Received"). The flows that depend on
// the screen (the sheet, the screenshot in WebKit) run on the phone as well as on desktop.
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
    const fake = createFakeFramebriar();
    await routeFramebriar(context, fake);
    await connectedOnTrips(page, fake);

    await page.getByRole("button", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    // This is an e2e build, so the screenshot is on, ticked by default, and shown as a thumbnail.
    await expect(
      dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("img", { name: "Screenshot of the screen you were on" }),
    ).toBeVisible();
    await expectAccessible(page, "feedback sheet");
    await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();

    // The browser goes offline with the sheet open: the sheet says so, and Send still works.
    await context.setOffline(true);
    await expect(
      dialog.getByText("You’re offline. It will be saved here and sent when you’re back online."),
    ).toBeVisible();
    // Playwright's WebKit keeps storage in memory only and cannot store a picture in IndexedDB (real Safari can), so on the
    // phone the saved report is notes-only; the capture itself was still taken in WebKit, as the thumbnail above shows.
    const phone = test.info().project.name === "phone";
    if (phone) {
      await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
    }
    await dialog.getByLabel("What happened?").fill("The bag count looks off");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
    expect(fake.delivered()).toHaveLength(0);

    await context.setOffline(false);
    await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
      timeout: 40_000,
    });
    const [delivered] = fake.delivered();
    expect(fake.delivered()).toHaveLength(1);
    expect(delivered.report.notes).toBe("The bag count looks off");
    expect(delivered.report.scene).toBe("trips");
    if (phone) expect(delivered.media).toBeNull();
    else expect(delivered.media?.bytes).toBeGreaterThan(0);
    // Only approved codes and numbers: no trip name, place, email or id.
    expect(JSON.stringify(delivered.report)).not.toMatch(/San Diego|@|\/trips\//);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  },
);

test("a server error is retried until the report is received", async ({ page, context }) => {
  const fake = createFakeFramebriar();
  await routeFramebriar(context, fake);
  await connectedOnTrips(page, fake);
  fake.failNext("report", { kind: "status", status: 503, retryAfterSeconds: 1 });

  const dialog = await writeAndSend(page, "Retry me");
  await expect(dialog.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Your feedback was received. Thank you.")).toBeVisible({
    timeout: 30_000,
  });
  expect(fake.count("report")).toBeGreaterThanOrEqual(2);
  expect(fake.delivered()).toHaveLength(1);
});

test("without the screenshot, only the notes are sent", async ({ page, context }) => {
  const fake = createFakeFramebriar();
  await routeFramebriar(context, fake);
  await connectedOnTrips(page, fake);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await dialog.getByLabel("What happened?").fill("Words only");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(
    dialog.getByRole("heading", { name: /Saved on this device|Received/ }),
  ).toBeVisible();
  await expect.poll(() => fake.delivered().length, { timeout: 30_000 }).toBe(1);
  expect(fake.delivered()[0].media).toBeNull();
});

test("disconnecting keeps the reports waiting on this device", async ({ page, context }) => {
  const fake = createFakeFramebriar();
  await routeFramebriar(context, fake);
  await connectedOnTrips(page, fake);
  fake.setOffline(true);
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
  await expect(page.getByLabel("Invitation")).toBeVisible();
  await page.reload();
  // Still on this device after a reload, and nothing was delivered.
  await expect(page.getByLabel("Invitation")).toBeVisible();
  expect(fake.delivered()).toHaveLength(0);
});

test("the Feedback button is not offered on Settings", DEVICE, async ({ page, context }) => {
  const fake = createFakeFramebriar();
  await routeFramebriar(context, fake);
  await connectedOnTrips(page, fake);
  await openSettingsFromNav(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
});
