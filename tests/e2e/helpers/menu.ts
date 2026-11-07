import type { Page } from "@playwright/test";

/** Open a trip's ⋯ menu on the dashboard and choose one item (Quick view, Copy trip, Archive, Remove), #155. */
export async function chooseFromMenu(page: Page, trip: string, item: string): Promise<void> {
  await page.getByRole("button", { name: `More actions for ${trip}` }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/**
 * Opens the Past & archive list from the Home. With a next trip the Home has no tab row (the phone Home has four pills and
 * the laptop Home a tag menu, #388), so it goes through the tag's menu; with none, the list's own tab is on screen.
 */
export async function openPastAndArchive(page: Page): Promise<void> {
  const tab = page.getByRole("button", { name: /^Past & archive/ });
  if ((await tab.count()) > 0) {
    await tab.click();
    return;
  }
  await page
    .getByRole("button", { name: /^More actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Past trips & archive", exact: true }).click();
}

/** The phone Home's Future pill (#388): the trips after the next one. */
export const futureTab = (page: Page) => page.getByRole("tab", { name: /^Future/ });

/** A later trip's row under the Future pill (opens the pill first). `name` is a trip name or a part of it. */
export async function futureRow(page: Page, name: string | RegExp) {
  await futureTab(page).click();
  return page.getByRole("list", { name: "Future trips" }).getByRole("link", { name });
}

/**
 * Clicks "Plan a trip" from the Home. The laptop Home and the empty Home show it at once; the phone Home keeps it in the
 * Future pill's panel (#388), so it opens that first when the link is not on screen.
 */
export async function planATrip(page: Page): Promise<void> {
  const link = page.getByRole("link", { name: /Plan a trip/ });
  await link.or(futureTab(page)).first().waitFor();
  if (!(await link.first().isVisible())) await futureTab(page).click();
  await link.first().click();
}
