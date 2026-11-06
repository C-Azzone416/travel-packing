import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseMode, nextButton, pickPlace } from "./helpers/plan";

// Plan a trip (#390), every width-changing state: the width bands (phone 195, 320, 390; laptop 1024, 1280, 1440) at normal and
// 200% text. At each, no step scrolls sideways and the Next button can be reached on screen. The switch to the laptop layout
// is at 1024: the live preview is beside the steps from there and is not on a phone until Review.
const BANDS = [195, 320, 390, 1024, 1280, 1440] as const;

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function expectWholeWords(
  locator: ReturnType<Page["locator"]>,
  label: string,
): Promise<void> {
  const broken = await locator.evaluate((root) => {
    const words: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const range = document.createRange();
        range.setStart(node, match.index ?? 0);
        range.setEnd(node, (match.index ?? 0) + match[0].length);
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        );
        if (rects.length > 1) words.push(match[0]);
      }
      node = walker.nextNode();
    }
    return words;
  });
  expect(broken, `${label}: words must wrap only at spaces`).toEqual([]);
}

async function walkSteps(page: Page, width: number) {
  const check = async (label: string) => {
    expect(await overflow(page), `${label} at ${width}`).toBeLessThanOrEqual(0);
    await nextButton(page)
      .or(page.getByRole("button", { name: "Create trip" }))
      .scrollIntoViewIfNeeded();
    const box = (await nextButton(page)
      .or(page.getByRole("button", { name: "Create trip" }))
      .boundingBox())!;
    expect(box.x, `${label} at ${width}: the button is on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, `${label} at ${width}: the button fits`).toBeLessThanOrEqual(
      width + 0.5,
    );
  };
  await pickPlace(page, "lon", /England/);
  await page.getByRole("button", { name: "Add a stop" }).click();
  await pickPlace(page, "par", /Paris/, "Destination search, Stop 2");
  await check("where, two stops");
  await nextButton(page).click();
  await page.getByLabel("Arrive", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-15");
  await page.getByLabel("Leave, Stop 2").fill("2026-11-20");
  await check("when");
  await nextButton(page).click();
  await check("how");
  await chooseMode(page, "Train or other");
  await nextButton(page).click();
  await check("starting list");
  await nextButton(page).click();
  await check("review");
}

for (const text of ["100%", "200%"] as const) {
  for (const width of BANDS) {
    test(`${width}px, ${text} text: no step scrolls sideways`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
      await page.setViewportSize({ width, height: 800 });
      await signInAsOwner(page);
      await page.goto("/trips/new");
      // Classic (always visible) scrollbars, as on Windows and the CI runners: they take 15px of the width that overlay
      // scrollbars (macOS) do not, so a row that only just fits shows up here.
      await page.addStyleTag({ content: "html::-webkit-scrollbar { width: 15px; }" });
      if (text === "200%")
        await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
      const laptop = width >= 1024;
      await expect(
        page.getByRole("complementary", { name: "Live preview of your trip" }),
      ).toHaveCount(laptop ? 1 : 0);
      await walkSteps(page, width);
      // The live preview appears on a phone only as Review's summary.
      await expect(
        page.getByRole("complementary", { name: "Live preview of your trip" }),
      ).toHaveCount(1);
    });
  }
}

test("1023px is the phone layout and 1024px the laptop's", async ({ page }) => {
  await signInAsOwner(page);
  await page.setViewportSize({ width: 1023, height: 800 });
  await page.goto("/trips/new");
  await expect(page.getByText("Step 1 of 5")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByText("Step 1 of 5")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Live preview of your trip" }),
  ).toBeVisible();
});

// 195px is the hard target (#332): no word is broken to fit a sliver of a column, and the header keeps its rows apart.
test("195px: the starting list's cards and the header keep whole words", async ({ page }) => {
  await signInAsOwner(page);
  await page.setViewportSize({ width: 195, height: 800 });
  await page.goto("/trips/new");
  const title = page.getByRole("heading", { name: "Plan a trip", level: 1 });
  const lineHeight = async (locator: ReturnType<Page["locator"]>) =>
    locator.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  const titleBox = (await title.boundingBox())!;
  // One line: "Plan a trip" is not stacked over three rows beside "Step 1 of 5".
  expect(titleBox.height).toBeLessThanOrEqual((await lineHeight(title)) * 1.5);
  await pickPlace(page, "lon", /England/);
  await nextButton(page).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-15");
  await nextButton(page).click();
  await chooseMode(page, "Fly");
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
  for (const name of [/Your Staples/, /Copy a past trip/, /I’ll have laundry/]) {
    const card = page.getByRole("checkbox", { name }).locator("xpath=ancestor::label");
    const heading = card.locator("[class*=optionTitle]");
    const description = card.locator("[class*=optionSub]");
    // The title column is wide enough for its longest word, and the description runs the card's full width.
    expect((await heading.boundingBox())!.width).toBeGreaterThanOrEqual(100);
    expect((await description.boundingBox())!.width).toBeGreaterThanOrEqual(130);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  }
  const weatherTitle = page
    .getByRole("checkbox", { name: /Weather suggestions/ })
    .locator("xpath=ancestor::label")
    .locator("[class*=optionTitle]");
  await expectWholeWords(weatherTitle, "Weather suggestions");

  await nextButton(page).click();
  await page.getByLabel("Name this trip").fill("Two Londons");
  const preview = page.getByRole("complementary", { name: "Live preview of your trip" });
  await expectWholeWords(preview.getByText("Two Londons", { exact: true }), "trip tag title");
  for (const cube of await preview
    .getByRole("list", { name: "Cubes" })
    .getByRole("listitem")
    .all()) {
    await expectWholeWords(cube, `cube ${await cube.textContent()}`);
  }
});
