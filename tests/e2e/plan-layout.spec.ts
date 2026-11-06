import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseMode, nextButton, pickPlace } from "./helpers/plan";

// Plan a trip (#390), every width-changing state: the width bands (phone 195, 320, 390; laptop 1024, 1280, 1440) at normal and
// 200% text. At each, no step scrolls sideways and the Next button can be reached on screen. The switch to the laptop layout
// is at 1024: the live preview is beside the steps from there and is not on a phone until Review.
const BANDS = [195, 320, 390, 1024, 1280, 1440] as const;

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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
