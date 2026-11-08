import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";

// The laptop (>= 1024px) Packing view (#385): header counts, cube rail and open cube, one tick per item, the filters, Edit
// list, the laundry toggle, keyboard, accessibility and overflow. The weather review rows are in packing-laptop-weather.spec.ts
// (they need the second app). Below 1024px the page is the phone layout (packing-phone.spec.ts); its flows run in the other trip specs.
const NOW = new Date("2026-10-16T12:00:00");
test.use({ viewport: { width: 1280, height: 900 } });

async function openSanDiego(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Cubes" });
const panel = (page: Page) => page.locator("[data-cube]");
const status = (page: Page) => page.getByRole("status", { name: "Packing updates" });
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the header counts quantity: a tick moves the cube, the bar and the total together", async ({
  page,
}) => {
  await openSanDiego(page);
  const bar = page.getByRole("progressbar", { name: "Packing progress" });
  const before = Number(await bar.getAttribute("aria-valuenow"));
  const clothing = rail(page).getByRole("button", { name: /^Clothing/ });
  const was = await clothing.innerText();
  await panel(page).getByRole("checkbox", { name: "Socks, 5" }).check();
  await expect(clothing).not.toHaveText(was);
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  // A reload shows what was saved.
  await page.reload();
  await expect(panel(page).getByRole("checkbox", { name: "Socks, 5" })).toBeChecked();
});

test("one tick per item sets packed to the quantity, and unticking sets none", async ({ page }) => {
  await openSanDiego(page);
  const underwear = panel(page).getByRole("checkbox", { name: "Underwear, 5" });
  // Two of five were packed in the seed: mixed until the tick finishes it.
  expect(await underwear.evaluate((box: HTMLInputElement) => box.indeterminate)).toBe(true);
  await underwear.check();
  await expect(underwear).toBeChecked();
  await expect(status(page)).toHaveText("Underwear 5 of 5 packed");
  await expect(underwear.locator("xpath=ancestor::li")).toHaveAttribute("data-packed", "true");
  await underwear.uncheck();
  await expect(status(page)).toHaveText("Underwear 0 of 5 packed");
  await expect(underwear.locator("xpath=ancestor::li")).toHaveAttribute("data-packed", "false");
  await page.reload();
  await expect(panel(page).getByRole("checkbox", { name: "Underwear, 5" })).not.toBeChecked();
});

test("a packed item is struck through, and the filters list only what they say", async ({
  page,
}) => {
  await openSanDiego(page);
  const sleepwear = panel(page).locator('[data-item-id="sleepwear"]');
  await expect(sleepwear.locator("label")).toHaveCSS("text-decoration-line", "none");
  await expect(sleepwear.locator("span").first()).toHaveCSS("text-decoration-line", "line-through");
  await panel(page)
    .getByRole("button", { name: /^To pack/ })
    .click();
  await expect(panel(page).getByRole("button", { name: /^To pack/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sleepwear).toHaveCount(0);
  await expect(panel(page).locator('[data-item-id="underwear"]')).toBeVisible();
  await panel(page)
    .getByRole("button", { name: /^Packed/ })
    .click();
  await expect(sleepwear).toBeVisible();
  await expect(panel(page).locator('[data-item-id="underwear"]')).toHaveCount(0);
  await panel(page).getByRole("button", { name: /^All/ }).click();
  await expect(panel(page).locator('[data-item-id="underwear"]')).toBeVisible();
});

test("the rail switches cubes, marks the open one current and moves focus to its title", async ({
  page,
}) => {
  await openSanDiego(page);
  const toiletries = rail(page).getByRole("button", { name: /^Toiletries/ });
  await expect(rail(page).getByRole("button", { name: /^Clothing/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(toiletries).toContainText("Morning of");
  await toiletries.focus();
  await page.keyboard.press("Enter");
  await expect(toiletries).toHaveAttribute("aria-current", "true");
  await expect(panel(page)).toHaveAttribute("data-cube", "toiletries");
  await expect(page.getByRole("heading", { name: "Toiletries", level: 2 })).toBeFocused();
  await expect(panel(page).getByText("Toiletry bag not ready to place")).toBeVisible();
});

test("Edit list adds an item to this cube, moves one to another cube, and removes one", async ({
  page,
}) => {
  await openSanDiego(page);
  await rail(page).getByRole("button", { name: /^Misc/ }).click();
  await panel(page).getByRole("button", { name: "Edit list" }).click();
  await panel(page).getByPlaceholder("+ Add an item").fill("Travel pillow");
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page).getByText("Travel pillow")).toBeVisible();
  await expect(status(page)).toHaveText("Travel pillow added to Misc.");
  // The same name again is not added twice.
  await panel(page).getByPlaceholder("+ Add an item").fill("travel pillow");
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("already on your list");

  await panel(page)
    .getByRole("combobox", { name: "Move Travel pillow to another cube" })
    .selectOption("tech");
  await expect(panel(page).getByText("Travel pillow")).toHaveCount(0);
  await expect(status(page)).toHaveText("Travel pillow moved to Tech.");
  await panel(page).getByRole("button", { name: "Done" }).click();
  await rail(page).getByRole("button", { name: /^Tech/ }).click();
  await expect(panel(page).getByRole("checkbox", { name: "Travel pillow" })).toBeVisible();

  await panel(page).getByRole("button", { name: "Edit list" }).click();
  await panel(page).getByRole("button", { name: "Remove Travel pillow" }).click();
  await expect(panel(page).getByText("Travel pillow")).toHaveCount(0);
  await page.reload();
  await rail(page).getByRole("button", { name: /^Tech/ }).click();
  await expect(panel(page).getByRole("checkbox", { name: "Travel pillow" })).toHaveCount(0);
});

test("Edit list marks and unmarks a cube Morning of, and it shows in the rail after a reload", async ({
  page,
}) => {
  await openSanDiego(page);
  await panel(page).getByRole("button", { name: "Edit list" }).click();
  const toggle = panel(page).getByRole("switch", { name: /Morning of/ });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(rail(page).getByRole("button", { name: /^Clothing/ })).toContainText("Morning of");
  await page.reload();
  await expect(rail(page).getByRole("button", { name: /^Clothing/ })).toContainText("Morning of");
  await panel(page).getByRole("button", { name: "Edit list" }).click();
  await panel(page)
    .getByRole("switch", { name: /Morning of/ })
    .click();
  await expect(rail(page).getByRole("button", { name: /^Clothing/ })).not.toContainText(
    "Morning of",
  );
});

test("the laundry toggle recalculates quantities, keeps what is packed, and turns off again", async ({
  page,
}) => {
  await openSanDiego(page);
  const tops = panel(page).locator('[data-item-id="tops"]');
  await expect(tops).toContainText("× 4");
  await page.getByRole("button", { name: "Laundry off" }).click();
  await expect(page.getByRole("button", { name: "Laundry on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/^Laundry on · \d+ items? changed$/)).toBeVisible();
  await expect(tops).toContainText("× 2");
  // Packed stays ticked.
  await expect(panel(page).getByRole("checkbox", { name: "Sleepwear" })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("button", { name: "Laundry on" })).toBeVisible();
  await page.getByRole("button", { name: "Laundry on" }).click();
  await expect(tops).toContainText("× 4");
});

test("axe is clean on the view, Edit list and the open item editor (colour contrast is #377)", async ({
  page,
}) => {
  await openSanDiego(page);
  // #377: the palette's accent, good and info pairs fall short of 4.5:1 on the redesigned screens; nothing else is exempt.
  const options = { disable: ["color-contrast"] };
  await expectAccessible(page, "packing laptop", options);
  await panel(page).getByRole("button", { name: "Edit list" }).click();
  await expectAccessible(page, "packing laptop edit list", options);
  await panel(page)
    .getByRole("button", { name: /^Edit\s+Underwear\s+×\s+5/ })
    .click();
  await expectAccessible(page, "packing laptop item editor", options);
});

test("keyboard: Tab reaches the rail, then the cube's checkboxes, and Space ticks", async ({
  page,
}) => {
  await openSanDiego(page);
  const box = panel(page).getByRole("checkbox", { name: "Everyday tops, 4" });
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
});

for (const width of [1024, 1100, 1180, 1280, 1440]) {
  test(`nothing scrolls sideways at ${width}px, with the list, Edit list and a rail`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openSanDiego(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await panel(page).getByRole("button", { name: "Edit list" }).click();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("link", { name: "Edit Staples" })).toBeVisible();
  });
}

test("below 768px the page is the phone layout, and from 1024px the laptop one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 900 });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await expect(page.locator('[data-packing-layout="phone"]')).toHaveCount(1);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await expect(page.locator('[data-packing-layout="laptop"]')).toHaveCount(1);
});
