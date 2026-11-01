import { expect, test, type Locator, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import {
  connectedOnTrips,
  fakeFramebriar,
  forgetFeedbackEnrollment,
  openSettings,
  goToTrips,
} from "./helpers/feedback";

// Feedback from inside the trip editor (#296). The editor is a modal sheet, so the header's Feedback button is inert and covered
// while it is open; the editor's own header carries an entry that opens the same report flow. Real app, real server, real SDK
// outbox, fake Framebriar. The phone project runs the tagged specs (WebKit, iPhone 15).
test.beforeEach(() => fakeFramebriar.reset());

const editor = (page: Page) => page.getByRole("dialog", { name: "Edit trip" });
const report = (page: Page) => page.getByRole("dialog", { name: "Send feedback" });
const entry = (page: Page) => editor(page).getByRole("button", { name: "Send feedback" });
const bodyOf = (page: Page) => editor(page).locator(".edit-body");
const CANVAS = /^Your screenshot\. Marks you draw are sent with it/;
const GRID = 8;

/** Remembers every PNG the page turns into an object URL (the preview's picture is one) so a test can read its pixels. */
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

async function openTripPage(page: Page) {
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
}

async function openEditorOnTrip(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Edit preferences" }).click();
    await expect(editor(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Signed in, connected, on the San Diego trip with Edit trip open on Packing preferences. */
async function openEditor(page: Page, size?: { width: number; height: number }) {
  // A short desktop window so the editor's body overflows (the phone already is short).
  if (size && test.info().project.name === "desktop") await page.setViewportSize(size);
  await connectedOnTrips(page);
  await openTripPage(page);
  await openEditorOnTrip(page);
  await expect(entry(page)).toBeEnabled();
}

async function scrollEditorBody(page: Page, by: number) {
  const body = bodyOf(page);
  const room = await body.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(
    room,
    "the editor body must overflow, or the scroll proves nothing",
  ).toBeGreaterThanOrEqual(by);
  await body.evaluate((node, amount) => node.scrollTo(0, amount), by);
  return body.evaluate((node) => node.scrollTop);
}

/** Everything about the editor that must survive opening and cancelling Feedback. */
async function editorState(page: Page) {
  return {
    selectedTab: await editor(page)
      .getByRole("tab", { selected: true })
      .evaluate((node) => node.textContent),
    dots: await editor(page).locator(".edit-tab-dot").count(),
    laundry: await editor(page).getByRole("switch", { name: "Laundry access" }).isChecked(),
    scrollTop: await bodyOf(page).evaluate((node) => Math.round(node.scrollTop)),
    pageScrollY: await page.evaluate(() => window.scrollY),
    bodyOverflow: await page.evaluate(() => document.body.style.overflow),
  };
}

/** The methods of every request to the report endpoint from now on. */
function watchReports(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/feedback/reports")) seen.push(request.method());
  });
  return seen;
}

const focusedIn = (container: Locator) =>
  container.evaluate((node) => node.contains(document.activeElement));

/** An 8 x 8 grid of mean luminances of a PNG (base64), ignoring `inset` CSS pixels of its edge (rounded corners, shadow). */
async function lumaGrid(page: Page, png: string, cssWidth: number): Promise<number[]> {
  return page.evaluate(
    async ({ png, cssWidth, grid }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const inset = Math.round(6 * (image.naturalWidth / cssWidth));
      const w = image.naturalWidth - inset * 2;
      const h = image.naturalHeight - inset * 2;
      const pixels = context.getImageData(inset, inset, w, h).data;
      const out: number[] = [];
      for (let r = 0; r < grid; r += 1)
        for (let c = 0; c < grid; c += 1) {
          let sum = 0;
          let n = 0;
          for (let y = Math.floor((r * h) / grid); y < Math.floor(((r + 1) * h) / grid); y += 1)
            for (let x = Math.floor((c * w) / grid); x < Math.floor(((c + 1) * w) / grid); x += 1) {
              const i = (y * w + x) * 4;
              sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
              n += 1;
            }
          out.push(sum / Math.max(1, n));
        }
      return out;
    },
    { png, cssWidth, grid: GRID },
  );
}

const distance = (a: number[], b: number[]) =>
  a.reduce((total, value, index) => total + Math.abs(value - b[index]), 0) / a.length;

/** The last PNG the page made an object URL for (the preview's picture), as base64, with its pixel size and the page's size. */
async function previewPicture(page: Page) {
  return page.evaluate(async () => {
    const blobs = (window as unknown as { __pictures: Blob[] }).__pictures;
    const blob = blobs[blobs.length - 1];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const bitmap = await createImageBitmap(blob);
    return { base64: btoa(binary), width: bitmap.width, height: bitmap.height, page: innerWidth };
  });
}

test(
  "the editor header has a Feedback entry on every tab and step; the page's own button stays out of reach",
  DEVICE,
  async ({ page }) => {
    await openEditor(page);
    await expect(entry(page)).toHaveCount(1);
    expect(
      await page.locator(".feedback-button").evaluate((node) => !!node.closest("[inert]")),
    ).toBe(true);
    await editor(page).getByRole("tab", { name: "Route & dates" }).click();
    await expect(entry(page)).toBeVisible();
    await editor(page).getByRole("tab", { name: "Packing preferences" }).click();
    await editor(page).getByRole("switch", { name: "Laundry access" }).click();
    await editor(page).getByRole("button", { name: "Review changes" }).click();
    await expect(editor(page).getByRole("button", { name: "Apply changes" })).toBeVisible();
    await expect(entry(page)).toBeEnabled();
    // The editor's own dialog is not the report: no Feedback sheet until the entry is pressed.
    await expect(report(page)).toHaveCount(0);
  },
);

test(
  "pressing Feedback: the picture shows the visible editor (not blank, not blurred away), the sheet is on top, the editor is untouched after Cancel",
  DEVICE,
  async ({ page }) => {
    await rememberPictures(page);
    await openEditor(page, { width: 1280, height: 520 });
    await editor(page).getByRole("switch", { name: "Laundry access" }).click();
    await scrollEditorBody(page, 100);
    const before = await editorState(page);
    expect(before.dots).toBe(1);
    expect(
      before.pageScrollY,
      "the page itself is scrolled, which broke the capture",
    ).toBeGreaterThan(0);
    const reports = watchReports(page);

    const box = (await editor(page).boundingBox())!;
    const live = await page.screenshot({ clip: box });

    await entry(page).click();
    await expect(report(page).getByRole("img", { name: CANVAS })).toBeVisible();
    // The Feedback sheet is the topmost thing; the editor cannot be reached; focus is inside the sheet.
    expect(
      await report(page).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit !== null && node.contains(hit);
      }),
    ).toBe(true);
    expect(await editor(page).evaluate((node) => !!node.closest("[inert]"))).toBe(true);
    expect(await focusedIn(report(page))).toBe(true);

    // The picture: real size, and the editor in it matches what was on screen (same 8 x 8 luminance grid as a live screenshot).
    const picture = await previewPicture(page);
    expect(picture.width).toBeGreaterThan(0);
    expect(picture.height).toBeGreaterThan(0);
    const captured = await page.evaluate(
      async ({ png, box, pageWidth }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const scale = image.naturalWidth / pageWidth;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(box.width * scale);
        canvas.height = Math.round(box.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(
            image,
            Math.round(box.x * scale),
            Math.round(box.y * scale),
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { png: picture.base64, box, pageWidth: picture.page },
    );
    const shown = distance(
      await lumaGrid(page, captured, box.width),
      await lumaGrid(page, live.toString("base64"), box.width),
    );
    expect(shown, "the picture matches the editor on screen").toBeLessThan(8);

    // The same check must fail for a wrong picture: what the capture used to produce for a scrolled page was the page WITHOUT the
    // sheet. Take that picture (the editor hidden for a moment) and it must be told apart from the right one.
    await report(page).getByRole("button", { name: "Cancel" }).click();
    await expect(report(page)).toHaveCount(0);
    // Focus is back on the pressed entry (checked before the hidden-editor picture below, which would blur it).
    await expect(entry(page)).toBeFocused();
    const afterCancel = await editorState(page);
    await page.addStyleTag({ content: ".modal-backdrop { visibility: hidden !important; }" });
    const without = await page.screenshot({ clip: box });
    await page.evaluate(() => document.head.lastElementChild?.remove());
    const wrong = distance(
      await lumaGrid(page, captured, box.width),
      await lumaGrid(page, without.toString("base64"), box.width),
    );
    expect(wrong, "a picture missing the sheet is told apart from the right one").toBeGreaterThan(
      shown + 15,
    );
    await expect(editor(page)).toBeVisible();

    // Cancel changed nothing: same tab, values, dot, scroll positions; focus is on the entry; nothing was sent.
    expect(afterCancel).toEqual(before);
    expect(reports, "opening and cancelling sends nothing").toEqual([]);
    await expect(editor(page)).toBeVisible();
  },
);

test("keyboard: Enter opens it, Tab stays inside each sheet, Escape closes only Feedback, then the editor's own Escape guard", async ({
  page,
}) => {
  await openEditor(page);
  await editor(page).getByRole("switch", { name: "Laundry access" }).click();
  await entry(page).focus();
  await page.keyboard.press("Enter");
  await expect(report(page)).toBeVisible();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press(key);
      expect(await focusedIn(report(page)), `${key} ${step} stays in Feedback`).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(report(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await expect(entry(page)).toBeFocused();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press(key);
      expect(await focusedIn(editor(page)), `${key} ${step} stays in the editor`).toBe(true);
    }
  }
  // The editor's own Escape now asks before discarding the unsaved preference.
  await page.keyboard.press("Escape");
  await expect(editor(page).getByText("Discard your changes?")).toBeVisible();
  // Space on the entry opens Feedback too.
  await editor(page).getByRole("button", { name: "Keep editing" }).click();
  await entry(page).focus();
  await page.keyboard.press("Space");
  await expect(report(page)).toBeVisible();
});

test("a press outside the Feedback sheet does not close the editor or send anything; Send saves exactly one report", async ({
  page,
}) => {
  await openEditor(page);
  const reports = watchReports(page);
  await entry(page).click();
  await expect(report(page)).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(report(page)).toBeVisible();
  await expect(editor(page)).toBeVisible();
  expect(reports).toEqual([]);
  await report(page).getByLabel("What happened?").fill("Count looks off in the editor");
  expect(reports, "nothing is sent before Send").toEqual([]);
  await report(page).getByRole("button", { name: "Send" }).click();
  await expect(
    report(page).getByRole("heading", { name: /Saved on this device|Received/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await fakeFramebriar.delivered()).length, { timeout: 30_000 })
    .toBe(1);
  await report(page).getByRole("button", { name: "Done" }).click();
  await expect(report(page)).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("not connected: the entry is there but disabled and not tabbable; the editor is unaffected", async ({
  page,
}) => {
  await forgetFeedbackEnrollment(`e2e-${ownerEmailFor(test.info().project.name)}`);
  await openSettings(page);
  await goToTrips(page);
  await openTripPage(page);
  await openEditorOnTrip(page);
  await expect(entry(page)).toBeDisabled();
  await entry(page)
    .focus({ timeout: 500 })
    .catch(() => undefined);
  expect(await editor(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(entry(page)).not.toBeFocused();
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

async function headMetrics(page: Page) {
  return editor(page).evaluate((dialog) => {
    const rect = (node: Element | null) => {
      const r = node!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const lines = (node: Element) => {
      const style = getComputedStyle(node);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
      return Math.round(node.getBoundingClientRect().height / lineHeight);
    };
    const head = dialog.querySelector(".modal-head")!;
    const button = head.querySelector("[data-feedback-editor-entry]")!;
    const label = button.querySelector(".feedback-entry-label")!;
    return {
      title: rect(head.querySelector("h2")),
      titleLines: lines(head.querySelector("h2")!),
      description: rect(head.querySelector("p")),
      descriptionLines: lines(head.querySelector("p")!),
      entry: rect(button),
      close: rect(head.querySelector(".modal-close")),
      head: rect(head),
      dialog: rect(dialog),
      labelShown: getComputedStyle(label).display !== "none",
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

test(
  "the head holds title, description, Feedback and × on one row without overlap at 320, 390, 721, 768 and 1280, connected or not, and at 200% zoom",
  DEVICE,
  async ({ page }) => {
    await openEditor(page);
    const widths = [320, 390, 721, 768, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 700 ? 640 : 800 });
      const m = await headMetrics(page);
      const where = `at ${width}px`;
      expect(overlaps(m.entry, m.close), `entry and × ${where}`).toBe(false);
      expect(overlaps(m.entry, m.title), `entry and title ${where}`).toBe(false);
      expect(overlaps(m.entry, m.description), `entry and description ${where}`).toBe(false);
      expect(overlaps(m.close, m.title), `× and title ${where}`).toBe(false);
      expect(m.titleLines, `title lines ${where}`).toBe(1);
      expect(m.descriptionLines, `description lines ${where}`).toBeLessThanOrEqual(3);
      expect(m.entry.height, `entry height ${where}`).toBeGreaterThanOrEqual(43.9);
      expect(m.entry.width, `entry width ${where}`).toBeGreaterThanOrEqual(43.9);
      expect(m.close.height).toBeGreaterThanOrEqual(43.9);
      expect(m.labelShown, `label ${where}`).toBe(width >= 400);
      expect(m.entry.x + m.entry.width, `entry inside the dialog ${where}`).toBeLessThanOrEqual(
        m.dialog.x + m.dialog.width,
      );
      expect(m.pageOverflow, `no sideways scroll ${where}`).toBe(false);
      if (width >= 721) expect(m.title.width, `title room ${where}`).toBeGreaterThanOrEqual(200);
    }
    // 200% zoom of text: the same checks on the narrowest phone width with the root font doubled.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const zoomed = await headMetrics(page);
    expect(overlaps(zoomed.entry, zoomed.close), "entry and × at 200%").toBe(false);
    expect(overlaps(zoomed.entry, zoomed.title), "entry and title at 200%").toBe(false);
    expect(zoomed.pageOverflow, "no sideways scroll at 200%").toBe(false);

    // The overlap check can fail: pull the entry over the title and the same test says so.
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>("[data-feedback-editor-entry]")!;
      const title = document.querySelector(".modal-head h2")!.getBoundingClientRect();
      button.style.position = "relative";
      button.style.left = `${title.x - button.getBoundingClientRect().x}px`;
    });
    const forced = await headMetrics(page);
    expect(overlaps(forced.entry, forced.title) || overlaps(forced.entry, forced.close)).toBe(true);
  },
);

test("disconnected, the head is the same shape at 320 and 1280 (the disabled entry takes the same room)", async ({
  page,
}) => {
  await forgetFeedbackEnrollment(`e2e-${ownerEmailFor(test.info().project.name)}`);
  await openSettings(page);
  await goToTrips(page);
  await openTripPage(page);
  await openEditorOnTrip(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    const m = await headMetrics(page);
    expect(m.entry.width).toBeGreaterThanOrEqual(44);
    expect(overlaps(m.entry, m.title)).toBe(false);
    expect(overlaps(m.entry, m.close)).toBe(false);
    expect(m.titleLines).toBe(1);
  }
});
