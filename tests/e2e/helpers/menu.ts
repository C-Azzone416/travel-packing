import type { Page } from "@playwright/test";

/** Open a trip's ⋯ menu on the dashboard and choose one item (Quick view, Copy trip, Archive, Remove), #155. */
export async function chooseFromMenu(page: Page, trip: string, item: string): Promise<void> {
  await page.getByRole("button", { name: `More actions for ${trip}` }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}
