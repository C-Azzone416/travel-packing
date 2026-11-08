import { expect, type Locator, type Page } from "@playwright/test";

// The Packing screen (#385 laptop, #386 phone) shows ONE cube at a time, so a spec that needs an item first opens the cube it
// lives in. Both layouts have the same cube list (a navigation named "Cubes", with one button per cube), the same rows
// (`li[data-item-id]` with one checkbox) and the same Edit list pill, so these helpers work at every width.

/** The title of the Packing screen: "Pack mode" on a phone, "Packing" on a laptop. */
export const packingTitle = (page: Page): Locator =>
  page.getByRole("heading", { name: /^(Pack mode|Packing)$/, level: 1 });

/** Waits for the Packing screen to have loaded. */
export async function expectPacking(page: Page): Promise<void> {
  await expect(packingTitle(page)).toBeVisible();
}

export const cubeNav = (page: Page): Locator => page.getByRole("navigation", { name: "Cubes" });

/** The row of an item, only once its cube is open. */
export const itemRow = (page: Page, id: string): Locator => page.locator(`[data-item-id="${id}"]`);

/** Opens a cube by its name ("Clothing", "Toiletries" ...). */
export async function openCube(page: Page, name: string | RegExp): Promise<void> {
  const label = typeof name === "string" ? new RegExp(`^${name}`) : name;
  await cubeNav(page).getByRole("button", { name: label }).click();
}

/** Opens the cube that holds the item and returns its row. */
export async function showItem(page: Page, id: string): Promise<Locator> {
  const row = itemRow(page, id);
  if (await row.count()) return row;
  const chips = cubeNav(page).getByRole("button");
  await expect(chips.first()).toBeVisible();
  const total = await chips.count();
  for (let index = 0; index < total; index++) {
    await chips.nth(index).click();
    await expect(chips.nth(index)).toHaveAttribute("aria-current", "true");
    if (await row.count()) return row;
  }
  throw new Error(`No cube holds the item ${id}`);
}

/** Ticks an item (one tick packs its whole quantity). */
export async function tick(page: Page, id: string): Promise<void> {
  await (await showItem(page, id)).getByRole("checkbox").check();
}

/** Unticks an item. */
export async function untick(page: Page, id: string): Promise<void> {
  await (await showItem(page, id)).getByRole("checkbox").uncheck();
}

/** The ids of every item on the trip, cube by cube (opens each cube in turn). */
export async function allItemIds(page: Page): Promise<string[]> {
  const chips = cubeNav(page).getByRole("button");
  await expect(chips.first()).toBeVisible();
  const total = await chips.count();
  const ids: string[] = [];
  for (let index = 0; index < total; index++) {
    await chips.nth(index).click();
    await expect(chips.nth(index)).toHaveAttribute("aria-current", "true");
    ids.push(
      ...(await page
        .locator("[data-item-id]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id") as string))),
    );
  }
  return ids;
}

/** Opens Edit list on the cube that holds the item, then the item's editor. */
export async function openEditor(page: Page, id: string): Promise<void> {
  const row = await showItem(page, id);
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (!(await done.count())) await page.getByRole("button", { name: "Edit list" }).click();
  await row.getByRole("button", { name: /^Edit / }).click();
}

/** The item is somewhere on the trip (in any cube). */
export async function expectItem(page: Page, id: string): Promise<void> {
  expect(await allItemIds(page), `item ${id} is on the list`).toContain(id);
}

/** The item is in no cube. */
export async function expectNoItem(page: Page, id: string): Promise<void> {
  expect(await allItemIds(page), `item ${id} is not on the list`).not.toContain(id);
}

/** Opens the cube that holds an item with this name (as the row's text shows it) and returns its row. */
export async function showByName(page: Page, name: string): Promise<Locator> {
  const row = page.locator("[data-item-id]").filter({ hasText: name });
  if (await row.count()) return row.first();
  const chips = cubeNav(page).getByRole("button");
  await expect(chips.first()).toBeVisible();
  const total = await chips.count();
  for (let index = 0; index < total; index++) {
    await chips.nth(index).click();
    await expect(chips.nth(index)).toHaveAttribute("aria-current", "true");
    if (await row.count()) return row.first();
  }
  throw new Error(`No cube holds an item named ${name}`);
}

// All packed and Ready (#411): the ribbon on the suitcase handle and the "Review your bag" sheet.
/** The gold "All packed" ribbon on the suitcase handle. */
export const packedRibbon = (page: Page): Locator => page.locator('[data-packed-ribbon="gold"]');
/** The green "Ready" ribbon on the suitcase handle. */
export const readyRibbon = (page: Page): Locator => page.locator('[data-packed-ribbon="good"]');
/** The "Review your bag" sheet. */
export const reviewSheet = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Review your bag" });

const BATHROOM = ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"];

/**
 * Packs every item of the open trip one tap at a time (Bathroom last), then dismisses the "Toiletry bag in suitcase?" prompt
 * that the last Bathroom item opens with "Not yet", so the bag step is left for the Review sheet's gate (#411).
 */
export async function packEverythingLeavingBag(page: Page): Promise<void> {
  const ids = await allItemIds(page);
  for (const id of [...ids.filter((entry) => !BATHROOM.includes(entry)), ...BATHROOM]) {
    const box = (await showItem(page, id)).getByRole("checkbox");
    if (!(await box.isChecked())) await box.check();
  }
  const prompt = page.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not yet" }).click();
  await expect(prompt).toHaveCount(0);
}
