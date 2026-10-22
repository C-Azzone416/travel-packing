import { test } from "@playwright/test";

// Design approves each theme illustration from rendered crops at four sizes: the card on a phone and on desktop, and
// the trip header on a phone and on desktop (#48). The crops use the same fit as the app: cover, anchored at the focal
// point (72% across, 58% down). This renders the shipped files directly, so it needs no trips.
const THEMES = ["travel", "city", "beach", "outdoors", "theme_park", "home"] as const;
const CROPS = [
  ["card-phone", 354, 118],
  ["card-desktop", 524, 148],
  ["header-phone", 358, 236],
  ["header-desktop", 1064, 236],
] as const;

test.describe("theme art crops", () => {
  for (const theme of THEMES) {
    test(`${theme}`, async ({ page, baseURL }, testInfo) => {
      // One set of crops is enough: both projects would produce the same files.
      test.skip(testInfo.project.name !== "desktop", "one set is enough");
      for (const [crop, width, height] of CROPS) {
        await page.setViewportSize({ width, height });
        await page.setContent(
          `<body style="margin:0"><img id="art" src="${baseURL}/themes/${theme}.svg" alt="" style="display:block;width:${width}px;height:${height}px;object-fit:cover;object-position:72% 58%"></body>`,
        );
        await page.waitForFunction(() => {
          const image = document.getElementById("art") as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        });
        await page.screenshot({ path: `test-results/screenshots/theme-${theme}-${crop}.png` });
      }
    });
  }
});
