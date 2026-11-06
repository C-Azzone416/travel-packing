import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Save the live Edit-trip review (#389), acknowledging when packed counts will be reduced.
 */
export async function reviewAndApply(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog.getByRole("heading", { name: "What changes in your list" })).toBeVisible();
  const acknowledge = dialog.getByRole("checkbox", { name: /I understand/ });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await dialog.getByRole("button", { name: /Save \d+ changes?/ }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
}
