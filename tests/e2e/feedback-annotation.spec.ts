import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import { connectedOnTrips, fakeFramebriar } from "./helpers/feedback";

// Marking the screenshot in the feedback sheet (#266), against the real app, the real SDK outbox and the fake Framebriar. Pointer
// input is synthesised (a mouse on desktop, touch pointer events on the phone). The picture is the app's own capture of the screen.
// Playwright's WebKit keeps storage in memory only and cannot store a picture in IndexedDB (real Safari can), so what reaches the
// service is proved on desktop; the phone proves the editor, its marks and that Cancel and Send stay in view.
test.beforeEach(() => fakeFramebriar.reset());

const CANVAS = /^Your screenshot\. Marks you draw are sent with it/;
const INK_RED = [0xd9, 0x2d, 0x20] as const;

/**
 * Remembers every PNG the page turns into an object URL (the preview's picture is one), so a test can read the reviewed picture's
 * exact bytes: the page's security policy does not let it fetch a blob: address.
 */
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

async function openSheet(page: Page) {
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  // The capture is taken before the sheet opens; the editor appears with the picture.
  await expect(dialog.getByRole("img", { name: CANVAS })).toBeVisible();
  return dialog;
}

/** Where the picture really is inside the preview (it is shown whole, centred, letterboxed), in page coordinates. */
async function pictureBox(canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  return canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const box = canvasElement.getBoundingClientRect();
    const naturalWidth = canvasElement.width;
    const naturalHeight = canvasElement.height;
    const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width,
      height,
      naturalWidth,
      naturalHeight,
      scale,
    };
  });
}

/** A stroke from one point of the picture to another, as fractions of its width and height. */
async function strokeAcross(
  page: Page,
  canvas: Locator,
  from: [number, number],
  to: [number, number],
  kind: "mouse" | "touch",
) {
  const box = await pictureBox(canvas);
  const at = ([fx, fy]: [number, number]) => ({
    x: box.left + box.width * fx,
    y: box.top + box.height * fy,
  });
  const start = at(from);
  const end = at(to);
  if (kind === "mouse") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    return box;
  }
  await canvas.evaluate(
    (element, args) => {
      const fire = (type: string, x: number, y: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            clientX: x,
            clientY: y,
          }),
        );
      fire("pointerdown", args.start.x, args.start.y);
      for (let step = 1; step <= 8; step += 1) {
        fire(
          "pointermove",
          args.start.x + ((args.end.x - args.start.x) * step) / 8,
          args.start.y + ((args.end.y - args.start.y) * step) / 8,
        );
      }
      fire("pointerup", args.end.x, args.end.y);
    },
    { start, end },
  );
  return box;
}

/** The visible status line under the tools (the screen-reader announcement beside it says the same in other words). */
const status = (dialog: Locator) => dialog.locator(".shot-status");

const device = () => (test.info().project.name === "phone" ? "touch" : "mouse");

test(
  "the editor has four named inks, Undo and Clear drawing, takes marks, and keeps Cancel and Send in view",
  DEVICE,
  async ({ page }) => {
    await connectedOnTrips(page);
    const dialog = await openSheet(page);
    const canvas = dialog.getByRole("img", { name: CANVAS });

    const inks = dialog.getByRole("radiogroup", { name: "Ink colour" }).getByRole("radio");
    await expect(inks).toHaveCount(4);
    for (const name of ["Black", "Red", "Blue", "Yellow"]) {
      await expect(dialog.getByRole("radio", { name: new RegExp(name) })).toBeVisible();
    }
    await expect(dialog.getByRole("radio", { name: /Red/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      dialog.getByText("Draw on the screenshot with your finger or mouse."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Clear drawing" })).toBeDisabled();
    await expectAccessible(page, "feedback sheet with the editor");

    // The footer is pinned: both buttons are inside the screen without scrolling, then again after scrolling the body.
    const inView = async () => {
      const height = page.viewportSize()?.height ?? 0;
      for (const name of ["Cancel", "Send"]) {
        const box = await dialog.getByRole("button", { name }).boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= height).toBe(true);
      }
    };
    await inView();

    await dialog.getByRole("radio", { name: /Blue/ }).click();
    await strokeAcross(page, canvas, [0.2, 0.4], [0.7, 0.45], device());
    await expect(status(dialog)).toHaveText("1 mark.");
    await strokeAcross(page, canvas, [0.2, 0.6], [0.7, 0.65], device());
    await expect(status(dialog)).toHaveText("2 marks.");
    await dialog.getByRole("button", { name: "Undo" }).click();
    await expect(status(dialog)).toHaveText("1 mark.");
    await dialog.getByRole("button", { name: "Clear drawing" }).click();
    await expect(status(dialog)).toHaveText("Drawing cleared. Undo brings it back.");
    await dialog.getByRole("button", { name: "Undo" }).click();
    await expect(status(dialog)).toHaveText("1 mark.");
    await expectAccessible(page, "feedback sheet with a mark");
    await inView();

    // Unticking hides the editor (the footer does not move); ticking again brings the mark back.
    const tick = dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" });
    await tick.uncheck();
    await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
    await inView();
    await tick.check();
    await expect(status(dialog)).toHaveText("1 mark.");
  },
);

test(
  "the notes and the footer stay in view when the software keyboard leaves little of the screen",
  DEVICE,
  async ({ page }) => {
    await connectedOnTrips(page);
    const dialog = await openSheet(page);
    // A phone's visual viewport is about this tall with the keyboard open; the sheet follows it.
    await page.setViewportSize({ width: 390, height: 340 });
    const notes = dialog.getByLabel("What happened?");
    await notes.focus();
    await expect(notes).toBeFocused();
    // The sheet follows the visual viewport (a resize event), so the layout settles a moment after the size changes.
    await expect(async () => {
      for (const target of [
        dialog.getByRole("button", { name: "Cancel" }),
        dialog.getByRole("button", { name: "Send" }),
        notes,
      ]) {
        const box = await target.boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= 340).toBe(true);
      }
    }).toPass({ timeout: 5000 });
  },
);

test("a second finger is a pinch, not a mark", DEVICE, async ({ page }) => {
  await connectedOnTrips(page);
  const dialog = await openSheet(page);
  const canvas = dialog.getByRole("img", { name: CANVAS });
  const box = await pictureBox(canvas);
  await canvas.evaluate(
    (element, args) => {
      const fire = (type: string, id: number, x: number, y: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      fire("pointerdown", 1, args.x, args.y);
      fire("pointermove", 1, args.x + 40, args.y + 10);
      fire("pointerdown", 2, args.x + 100, args.y + 100);
      fire("pointermove", 1, args.x + 60, args.y + 20);
      fire("pointerup", 2, args.x + 100, args.y + 100);
      fire("pointerup", 1, args.x + 60, args.y + 20);
    },
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
  );
  await expect(status(dialog)).toHaveText("Draw on the screenshot with your finger or mouse.");
  await expect(dialog.getByRole("button", { name: "Undo" })).toBeDisabled();
});

/**
 * Compares the reviewed picture (the last PNG the page made an object URL for, i.e. the preview's) with the delivered one, pixel by
 * pixel: size, how many pixels differ outside / inside a region, the sampled colours of the delivered one, and the byte-for-byte
 * identity of the two files.
 */
async function comparePictures(
  page: Page,
  deliveredBase64: string,
  region: { x0: number; y0: number; x1: number; y1: number },
  samples: { x: number; y: number }[],
) {
  return page.evaluate(
    async ({ delivered, region, samples }) => {
      const pictures = (window as unknown as { __pictures: Blob[] }).__pictures;
      const reviewedBlob = pictures[pictures.length - 1];
      const deliveredBytes = Uint8Array.from(atob(delivered), (char) => char.charCodeAt(0));
      const reviewedBytes = new Uint8Array(await reviewedBlob.arrayBuffer());
      const decode = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
        };
      };
      const [a, b] = await Promise.all([
        decode(reviewedBlob),
        decode(new Blob([deliveredBytes], { type: "image/png" })),
      ]);
      const identical =
        reviewedBytes.length === deliveredBytes.length &&
        reviewedBytes.every((byte, index) => byte === deliveredBytes[index]);
      if (a.width !== b.width || a.height !== b.height) {
        return { sameSize: false, identical, outside: -1, inside: -1, colours: [] as number[][] };
      }
      let outside = 0;
      let inside = 0;
      for (let y = 0; y < a.height; y += 1) {
        for (let x = 0; x < a.width; x += 1) {
          const at = (y * a.width + x) * 4;
          const differs =
            a.data[at] !== b.data[at] ||
            a.data[at + 1] !== b.data[at + 1] ||
            a.data[at + 2] !== b.data[at + 2] ||
            a.data[at + 3] !== b.data[at + 3];
          if (!differs) continue;
          const within = x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
          if (within) inside += 1;
          else outside += 1;
        }
      }
      const colours = samples.map(({ x, y }) => {
        const at = (Math.round(y) * b.width + Math.round(x)) * 4;
        return [b.data[at], b.data[at + 1], b.data[at + 2]];
      });
      return { sameSize: true, identical, outside, inside, colours };
    },
    { delivered: deliveredBase64, region, samples },
  );
}

test("the queued PNG is the reviewed screenshot with the marks drawn on it, and nothing else changed", async ({
  page,
}) => {
  await rememberPictures(page);
  await connectedOnTrips(page);
  const dialog = await openSheet(page);
  const canvas = dialog.getByRole("img", { name: CANVAS });

  // One horizontal red stroke across the middle of the picture.
  const box = await strokeAcross(page, canvas, [0.2, 0.5], [0.8, 0.5], "mouse");
  await expect(status(dialog)).toHaveText("1 mark.");
  await dialog.getByLabel("What happened?").fill("The bag count looks off");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
    timeout: 40_000,
  });

  const [delivered] = await fakeFramebriar.delivered();
  expect(delivered.mediaBytes).toBeGreaterThan(0);
  expect(delivered.mediaBytes).toBeLessThan(4_000_000);
  const png = await fakeFramebriar.mediaOf(delivered.report.id);
  expect(png).not.toBeNull();

  // Stroke geometry in the picture's natural pixels. A CSS pixel is `unit` natural pixels; the colour is 4 CSS px wide.
  const unit = 1 / box.scale;
  const core = Math.max(3, 4 * unit);
  const y = box.naturalHeight * 0.5;
  const x0 = box.naturalWidth * 0.2;
  const x1 = box.naturalWidth * 0.8;
  const midX = (x0 + x1) / 2;
  const reach = core / 2 + 2.5 * unit + 3;
  const result = await comparePictures(
    page,
    png as string,
    { x0: x0 - reach, y0: y - reach, x1: x1 + reach, y1: y + reach },
    [
      { x: midX, y }, // the colour
      { x: midX, y: y - (core / 2 + 0.75 * unit) }, // the white halo
      { x: midX, y: y - (core / 2 + 2 * unit) }, // the near-black outline
    ],
  );
  expect(result.sameSize).toBe(true);
  expect(result.identical).toBe(false);
  // Not one pixel outside the stroke's own area differs: it is the reviewed picture, and it was not scaled, cropped or redrawn.
  expect(result.outside).toBe(0);
  expect(result.inside).toBeGreaterThan(0);
  const [colour, halo, outline] = result.colours;
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(colour[channel] - INK_RED[channel])).toBeLessThanOrEqual(8);
  }
  expect(halo.every((value) => value >= 235)).toBe(true);
  expect(outline.every((value) => value <= 40)).toBe(true);
});

test("a picture with no marks is queued as the reviewed picture itself, byte for byte", async ({
  page,
}) => {
  await rememberPictures(page);
  await connectedOnTrips(page);
  const dialog = await openSheet(page);
  await dialog.getByLabel("What happened?").fill("No marks on this one");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
    timeout: 40_000,
  });
  const [delivered] = await fakeFramebriar.delivered();
  const png = await fakeFramebriar.mediaOf(delivered.report.id);
  const result = await comparePictures(page, png as string, { x0: 0, y0: 0, x1: -1, y1: -1 }, []);
  expect(result.identical).toBe(true);
  expect(result.outside).toBe(0);
});

test("unticking after drawing sends the notes only: no picture is saved or uploaded", async ({
  page,
}) => {
  await connectedOnTrips(page);
  const dialog = await openSheet(page);
  await strokeAcross(
    page,
    dialog.getByRole("img", { name: CANVAS }),
    [0.3, 0.3],
    [0.6, 0.6],
    "mouse",
  );
  await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
  await dialog.getByLabel("What happened?").fill("Text only");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
    timeout: 40_000,
  });
  const [delivered] = await fakeFramebriar.delivered();
  expect(delivered.mediaBytes).toBeNull();
  expect(await fakeFramebriar.mediaOf(delivered.report.id)).toBeNull();
});

/**
 * Makes every PNG the page makes after the first `skip` ones larger than the send limit by appending bytes after the PNG's end
 * (still a valid PNG). The first picture is the screen capture; the next is the composite made at Send.
 */
async function padPicturesAfter(page: Page, skip: number) {
  await page.addInitScript(
    ({ skip: skipped }) => {
      const original = HTMLCanvasElement.prototype.toBlob;
      let made = 0;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        original.call(
          this,
          (blob) => {
            made += 1;
            if (blob && blob.type === "image/png" && made > skipped) {
              callback(new Blob([blob, new Uint8Array(4_300_000)], { type: "image/png" }));
            } else callback(blob);
          },
          type,
          quality,
        );
      };
    },
    { skip },
  );
}

test("marks that push the picture over the limit are refused, nothing is queued, and Clear drawing recovers", async ({
  page,
}) => {
  await padPicturesAfter(page, 1);
  await connectedOnTrips(page);
  const dialog = await openSheet(page);
  await strokeAcross(
    page,
    dialog.getByRole("img", { name: CANVAS }),
    [0.2, 0.5],
    [0.8, 0.5],
    "mouse",
  );
  await dialog.getByLabel("What happened?").fill("Too much ink");
  await dialog.getByRole("button", { name: "Send" }).click();

  const alert = dialog.getByRole("alert").filter({ hasText: /over the 4\.0 MB limit/ });
  await expect(alert).toContainText("Your screenshot with marks is 4.");
  await expect(alert).toContainText("Nothing was shrunk or cropped.");
  await expectAccessible(page, "feedback sheet with the oversize alert");
  expect(await fakeFramebriar.delivered()).toHaveLength(0);
  expect((await fakeFramebriar.counts()).report).toBe(0);
  // Send and the notes are still there; the footer is still in view.
  await expect(dialog.getByLabel("What happened?")).toHaveValue("Too much ink");
  await expect(dialog.getByRole("button", { name: "Send" })).toBeEnabled();

  // Removing the marks removes the problem, and the reviewed picture goes out untouched.
  await dialog.getByRole("button", { name: "Clear drawing" }).click();
  await expect(alert).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
    timeout: 40_000,
  });
  const [delivered] = await fakeFramebriar.delivered();
  expect(delivered.mediaBytes).toBeLessThan(4_000_000);
});

test("a screenshot that is too large on its own says so, hides the tools, and unticking sends the notes", async ({
  page,
}) => {
  await padPicturesAfter(page, 0);
  await connectedOnTrips(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(
    dialog.getByRole("alert").filter({ hasText: /^⚠ This screenshot is 4\./ }),
  ).toContainText("over the 4.0 MB limit, so it can’t be sent.");
  await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
  await dialog.getByLabel("What happened?").fill("Big picture");
  await dialog.getByRole("button", { name: "Send" }).click();
  expect(await fakeFramebriar.delivered()).toHaveLength(0);
  await dialog.getByRole("checkbox", { name: "Include a screenshot of this screen" }).uncheck();
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("heading", { name: "Received. Thank you." })).toBeVisible({
    timeout: 40_000,
  });
  const [delivered] = await fakeFramebriar.delivered();
  expect(delivered.mediaBytes).toBeNull();
});
