import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";

// The accessibility helper re-checks each flagged element after scrolling it into view (a short phone viewport makes axe misread
// labels below the fold). These two tests keep that second look honest: a real violation must still fail, and a clean page must pass.
const page_ = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Helper check</title></head><body><main><h1>Helper check</h1>${body}</main></body></html>`;

test("the accessibility helper still fails on a real violation, even one far below the fold", async ({
  page,
}) => {
  await page.setContent(page_(`<div style="height:3000px"></div><input type="text" id="nolabel">`));
  await expect(expectAccessible(page, "unlabelled field")).rejects.toThrow(/axe violations/);
});

test("the accessibility helper passes a labelled field far below the fold", async ({ page }) => {
  await page.setContent(
    page_(
      `<div style="height:3000px"></div><label for="ok">Name</label><input type="text" id="ok">`,
    ),
  );
  await expectAccessible(page, "labelled field");
});
