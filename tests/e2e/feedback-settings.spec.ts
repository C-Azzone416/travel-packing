import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { connectedOnTrips, fakeFramebriar, openSettingsFromNav } from "./helpers/feedback";

// Feedback from Settings with the sensitive parts left out of the picture (#273), against the real app, the real capture library
// and a fake Framebriar. The proof is pixels: two synthetic canary colours are painted on the live page, magenta on the account
// email row (found by its TEXT, not by the app's own exclusion marker, so removing the marker cannot make this pass) and cyan on
// an ordinary card. The picture the sheet shows (the very PNG that would be queued) must contain no magenta and some cyan, while
// the live page shows both. Nothing real is in any image and nothing is sent: every test cancels the sheet.
test.beforeEach(() => fakeFramebriar.reset());

const MAGENTA = [255, 0, 255] as const;
const CYAN = [0, 255, 255] as const;
const CANVAS = /^Your screenshot\. Marks you draw are sent with it/;
const MIN_PIXELS = 300;

/** Remembers every PNG the page makes an object URL for: the preview's picture is the reviewed screenshot, read from its bytes. */
async function rememberPictures(page: Page) {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    const store: Blob[] = [];
    (window as unknown as { __pictures: Blob[] }).__pictures = store;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob && object.type === "image/png") store.push(object);
      return original(object);
    };
  });
}

/** Paints the canaries on the live Settings page, finding the email row by its text. Returns what it painted. */
async function paintCanaries(page: Page, email: string) {
  return page.evaluate((address) => {
    const paint = (element: Element, color: string) => {
      const style = (element as HTMLElement).style;
      style.setProperty("background", color, "important");
      style.setProperty("color", color, "important");
      style.setProperty("border-color", color, "important");
    };
    const rows = [...document.querySelectorAll("p")].filter((p) =>
      p.textContent?.includes(address),
    );
    for (const row of rows) paint(row, "#ff00ff");
    // An ordinary region that must stay in the picture: the Save status card, next to the Account card.
    const heading = [...document.querySelectorAll("h2")].find(
      (h) => h.textContent === "Save status",
    );
    const card = heading?.closest("section") ?? null;
    if (card) (card as HTMLElement).style.setProperty("background", "#00ffff", "important");
    return { emailRows: rows.length, ordinaryCard: card !== null };
  }, email);
}

/** How many pixels of a PNG (base64) are within a few levels of a colour. */
async function countColour(
  page: Page,
  base64: string,
  [r, g, b]: readonly [number, number, number],
) {
  return page.evaluate(
    async ({ data, r, g, b }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let count = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        if (
          Math.abs(pixels[at] - r) < 14 &&
          Math.abs(pixels[at + 1] - g) < 14 &&
          Math.abs(pixels[at + 2] - b) < 14
        )
          count += 1;
      }
      return count;
    },
    { data: base64, r, g, b },
  );
}

/** The reviewed screenshot (the preview's PNG) as base64. */
const reviewedPicture = (page: Page) =>
  page.evaluate(async () => {
    const pictures = (window as unknown as { __pictures: Blob[] }).__pictures;
    const bytes = new Uint8Array(await pictures[pictures.length - 1].arrayBuffer());
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });

const live = async (page: Page) => (await page.screenshot()).toString("base64");

/**
 * Opens the sheet from the header button WITHOUT scrolling: the header is not sticky, so a real click would first scroll the page back
 * to the top and the picture would not be of the scrolled position at all.
 */
async function openFromHeader(page: Page) {
  await page.locator(".feedback-button").evaluate((button) => (button as HTMLElement).click());
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Scrolls the Account heading into place at once (the page's own scrolling is smooth, and a picture taken mid-scroll proves nothing). */
async function scrollAccount(page: Page, block: "start" | "center" | "end") {
  await page
    .getByRole("heading", { name: "Account", level: 2 })
    .evaluate((h, where) => h.scrollIntoView({ block: where, behavior: "instant" }), block);
  await page.waitForTimeout(300);
}

const email = () => ownerEmailFor(test.info().project.name);

/**
 * Playwright's WebKit (and so, very likely, Safari on a phone) takes the picture from the top of the page whatever the scroll
 * position: the capture library's scroll offset is not honoured there. That does not change what is left out (the exclusion is
 * decided before the picture is made), but a phone test can only see the Account card if it is inside the first screen, so the phone
 * is given a screen tall enough to hold the whole Settings page. The scrolled-position test is desktop-only for the same reason.
 */
async function tallPhone(page: Page) {
  if (test.info().project.name === "phone")
    await page.setViewportSize({ width: 390, height: 2400 });
}

async function settingsReady(page: Page) {
  await rememberPictures(page);
  await connectedOnTrips(page);
  await openSettingsFromNav(page);
  await expect(page.getByText(email())).toBeVisible();
}

test(
  "the picture of Settings leaves the account email out and keeps the ordinary cards (Account card in view)",
  DEVICE,
  async ({ page }) => {
    await settingsReady(page);
    await tallPhone(page);
    const painted = await paintCanaries(page, email());
    expect(painted).toEqual({ emailRows: 1, ordinaryCard: true });
    // The Account card at the top of the screen: the cards below it (the ordinary canary) are then on screen too, even on a phone.
    await scrollAccount(page, "start");

    // The canaries really are on screen right now (so an empty result below means something).
    const before = await live(page);
    expect(await countColour(page, before, MAGENTA)).toBeGreaterThan(MIN_PIXELS);
    expect(await countColour(page, before, CYAN)).toBeGreaterThan(MIN_PIXELS);

    const dialog = await openFromHeader(page);
    await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
    const picture = await reviewedPicture(page);
    expect(await countColour(page, picture, MAGENTA)).toBe(0);
    expect(await countColour(page, picture, CYAN)).toBeGreaterThan(MIN_PIXELS);

    // The sheet says what was left out, under the preview, and offers the usual choices.
    await expect(
      dialog.getByText(
        "Your account email and any invitation or password field are left out of this screenshot.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }),
    ).toBeChecked();
    await expectAccessible(page, "feedback sheet opened from Settings");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await fakeFramebriar.delivered()).toHaveLength(0);
  },
);

test(
  "scrolled Settings: the email row is still absent, however the page is positioned",
  DEVICE,
  async ({ page }) => {
    await settingsReady(page);
    test.skip(
      test.info().project.name === "phone",
      "WebKit takes the picture from the top of the page whatever the scroll (see tallPhone)",
    );
    await paintCanaries(page, email());
    for (const block of ["start", "center"] as const) {
      await scrollAccount(page, block);
      expect(await countColour(page, await live(page), MAGENTA)).toBeGreaterThan(MIN_PIXELS);
      const dialog = await openFromHeader(page);
      await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
      expect(await countColour(page, await reviewedPicture(page), MAGENTA)).toBe(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    }
  },
);

test(
  "a visible error state on Settings does not bring the email back",
  DEVICE,
  async ({ page }) => {
    await settingsReady(page);
    await tallPhone(page);
    // The service is unreachable, so Disconnect cannot finish: the card shows its message.
    await fakeFramebriar.setOffline(true);
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page
      .getByRole("group", { name: "Disconnect feedback" })
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await paintCanaries(page, email());
    await scrollAccount(page, "center");
    expect(await countColour(page, await live(page), MAGENTA)).toBeGreaterThan(MIN_PIXELS);

    const dialog = await openFromHeader(page);
    await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
    expect(await countColour(page, await reviewedPicture(page), MAGENTA)).toBe(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  },
);

test(
  "the card's Send feedback and the header button open the same sheet, and focus goes back to each",
  DEVICE,
  async ({ page }) => {
    await settingsReady(page);
    const card = page.locator(".feedback-send-action");
    const header = page.locator(".feedback-button");
    await expect(card).toHaveText("Send feedback");
    await expect(header).toBeEnabled();

    await card.scrollIntoViewIfNeeded();
    await card.click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(card).toBeFocused();

    await header.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(header).toBeFocused();
  },
);

test(
  "with something private open there is no picture, and the notes still go: the sheet says so",
  DEVICE,
  async ({ page }) => {
    await settingsReady(page);
    // Stand in for any marked sensitive dialog being open (the real one, Close account, is a modal that makes the page inert).
    await page.evaluate(() => {
      const portal = document.createElement("div");
      portal.setAttribute("data-feedback-sensitive-portal", "");
      document.body.append(portal);
    });
    const dialog = await openFromHeader(page);
    await expect(dialog.locator(".feedback-no-shot")).toHaveText(
      "ⓘ No screenshot this time: something private is open on this screen. You can still send your notes.",
    );
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("img", { name: CANVAS })).toHaveCount(0);
    await expectAccessible(page, "feedback sheet with no screenshot");

    // The notes still go, as text only.
    await dialog.getByLabel("What happened?").fill("Something private was open");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(
      dialog.getByRole("heading", { name: /Saved on this device|Received\. Thank you\./ }),
    ).toBeVisible();
    if (test.info().project.name !== "phone") {
      await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
        timeout: 40_000,
      });
      const [delivered] = await fakeFramebriar.delivered();
      expect(delivered.mediaBytes).toBeNull();
    }
  },
);

test("opening the Close account dialog is a private surface: the page goes inert and no picture can be taken", async ({
  page,
}) => {
  await settingsReady(page);
  await page.getByRole("button", { name: "Close account", exact: true }).click();
  const closing = page.getByRole("dialog", { name: "Close your account?" });
  await expect(closing).toBeVisible();
  // Nothing outside the dialog can be pressed, so the Feedback controls cannot start a capture.
  const inert = await page.evaluate(
    () => document.querySelector(".feedback-button")?.closest("[inert]") !== null,
  );
  expect(inert).toBe(true);
  expect(
    await page.evaluate(() => document.querySelector("[data-feedback-sensitive-portal]") !== null),
  ).toBe(true);
  await closing.getByRole("button", { name: "Cancel" }).click();
  expect(
    await page.evaluate(() => document.querySelector("[data-feedback-sensitive-portal]") !== null),
  ).toBe(false);
});

test(
  "when not connected there is no Send feedback in the card, and the header button is dimmed",
  DEVICE,
  async ({ page }) => {
    await rememberPictures(page);
    const { signInAsOwner } = await import("./helpers/auth");
    await signInAsOwner(page);
    await openSettingsFromNav(page);
    await expect(page.locator(".feedback-send-action")).toHaveCount(0);
    await expect(page.locator(".feedback-button")).toBeDisabled();
    await expect(page.getByLabel("Invitation")).toBeVisible();
  },
);
