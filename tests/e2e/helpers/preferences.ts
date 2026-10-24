import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Review the packing-preference changes in the Edit trip sheet and apply them (#203): "Review changes", the acknowledgement
 * when the review asks for one (packed counts drop, or packed/edited items are removed), then "Apply changes".
 */
export async function reviewAndApply(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog.getByRole("heading", { name: "Review changes to your list" })).toBeVisible();
  const acknowledge = dialog.getByRole("checkbox", { name: /I understand/ });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
}
