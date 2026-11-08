import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Save the changes made in the Edit trip sheet (#203, #389): tick the acknowledgement when the live "What changes in your list"
 * panel asks for one (packed counts drop, or packed/edited items are removed), then "Save N changes".
 */
export async function reviewAndApply(page: Page, dialog: Locator): Promise<void> {
  await expect(
    dialog.getByRole("heading", { name: /What changes in your list|changes/ }).first(),
  ).toBeVisible();
  const acknowledge = dialog.getByRole("checkbox", { name: /I understand/ });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await dialog.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toHaveCount(0);
}

/**
 * Below 1024px the Edit trip sheet can fold its list of changes away behind "See what moves" (it starts open while short):
 * open it. On the laptop sheet there is no such button and the list is always shown.
 */
export async function showEditChanges(dialog: Locator): Promise<void> {
  const moves = dialog.getByRole("button", { name: /See what moves/ });
  if ((await moves.isVisible()) && (await moves.getAttribute("aria-expanded")) === "false")
    await moves.click();
  await expect(dialog.getByRole("list", { name: "What changes in your list" })).toBeVisible();
}
