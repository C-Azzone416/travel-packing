import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn, setupEmailFor } from "./helpers/auth";
import { resetStaplesSetup, setStaplesSetupLifecycle } from "./helpers/database";
import { DEVICE } from "./helpers/device";

test(
  "first-use Staples setup is optional, resumable, and personal",
  DEVICE,
  async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    const ownerId = `e2e-${email}`;
    await resetStaplesSetup(ownerId);
    await signIn(page, email);

    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Underwear" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Socks" })).not.toBeChecked();
    await expect(page.locator(".staples-suggestion-check .save-list-box").first()).toBeVisible();
    if (testInfo.project.name === "desktop") {
      const heading = (await page
        .getByRole("heading", { name: "Build your Staples" })
        .boundingBox())!;
      const firstCategory = (await page.getByRole("heading", { name: "Clothing" }).boundingBox())!;
      expect(Math.round(heading.x)).toBe(Math.round(firstCategory.x));
      expect((await page.locator(".staples-setup").boundingBox())!.width).toBeLessThanOrEqual(760);
    } else {
      const actions = (await page.locator(".staples-setup-actions").boundingBox())!;
      const navigation = (await page
        .getByRole("navigation", { name: "Primary navigation" })
        .boundingBox())!;
      expect(actions.y + actions.height).toBeLessThanOrEqual(navigation.y);
    }

    await page.getByRole("button", { name: "Skip for now" }).click();
    const reminder = page.getByRole("complementary", { name: "Staples setup reminder" });
    await expect(reminder).toBeVisible();
    if (testInfo.project.name === "phone") {
      const reminderBox = (await reminder.boundingBox())!;
      expect(reminderBox.width).toBeGreaterThanOrEqual(350);
      const build = (await reminder.getByRole("button", { name: "Build Staples" }).boundingBox())!;
      const dismiss = (await reminder
        .getByRole("button", { name: "Don’t remind me" })
        .boundingBox())!;
      expect(build.y + build.height).toBeLessThanOrEqual(dismiss.y);
    }
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.getByText("Your Staples list is intentionally empty.")).toBeVisible();
    await page.getByRole("link", { name: "Trips", exact: true }).click();
    await page.getByRole("button", { name: "Build Staples" }).click();
    await page.getByRole("checkbox", { name: "Socks" }).check();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toBeVisible();

    await page.getByRole("button", { name: "Build Staples" }).click();
    await expect(page.getByRole("checkbox", { name: "Socks" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await page.getByRole("button", { name: "Edit Underwear, 1 per day" }).click();
    const editor = page.getByRole("dialog", { name: "Edit staple" });
    await editor.getByRole("radio", { name: /^Smart/ }).check();
    await editor.getByRole("radio", { name: /^Toiletry bag/ }).check();
    await editor.getByRole("switch", { name: "Pack last" }).check();
    await editor.getByRole("button", { name: "Save staple" }).click();
    await page.getByRole("button", { name: "Save 1 Staples" }).click();

    await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Staples setup reminder" })).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Staples" }).click();
    const underwear = page.locator('[data-staple-id="underwear"]');
    // Smart keeps its legacy label; a toiletry-bag item is filed in the Toiletries cube.
    await expect(underwear).toContainText("smart");
    await expect(underwear).toContainText("Pack last");
    await expect(
      page.getByRole("region", { name: "Toiletries" }).locator('[data-staple-id="underwear"]'),
    ).toBeVisible();

    await underwear.getByRole("button", { name: /^Underwear/ }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(underwear).toHaveCount(0);
  },
);

test(
  "a failed atomic setup save keeps selections, exposes busy state, and retries",
  DEVICE,
  async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    await resetStaplesSetup(`e2e-${email}`);
    await signIn(page, email);
    await page.getByRole("checkbox", { name: "Underwear" }).check();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && new URL(request.url()).pathname === "/") {
        await held;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    const click = page.getByRole("button", { name: "Save 1 Staples" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
    release();
    await click;
    const error = page.locator(".staples-setup-error");
    await expect(error).toContainText("Couldn’t save your Staples.");
    await expect(error).toContainText("Your selections are still here.");
    await expect(page.getByRole("checkbox", { name: "Underwear" })).toBeChecked();
    await expect(page.getByText("Couldn’t load your Staples setup.")).toHaveCount(0);

    await page.unroute("**/*");
    await page.getByRole("button", { name: "Try save again" }).click();
    await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.locator('[data-staple-id="underwear"]')).toBeVisible();
  },
);

async function openSetup(page: Page, testInfo: { project: { name: string } }) {
  const email = setupEmailFor(testInfo.project.name);
  await resetStaplesSetup(`e2e-${email}`);
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
  return `e2e-${email}`;
}

async function editRule(page: Page, row: Locator, qty: string, cadence: RegExp) {
  await row.getByRole("button", { name: /^Edit / }).click();
  const editor = page.getByRole("dialog", { name: "Edit staple" });
  await editor.getByLabel("Quantity").fill(qty);
  await editor.getByRole("radio", { name: cadence }).check();
  await editor.getByRole("button", { name: "Save staple" }).click();
}

const rowOf = (page: Page, name: string) =>
  page
    .getByRole("checkbox", { name })
    .locator("xpath=ancestor::div[contains(@class,'staple-row')]");

test(
  "first-time setup shows and persists the catalog rules for Toothbrush and Underwear",
  DEVICE,
  async ({ page }, testInfo) => {
    await openSetup(page, testInfo);
    await page.getByRole("checkbox", { name: "Toothbrush" }).check();
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await expect(rowOf(page, "Toothbrush")).toContainText("1 per trip");
    await expect(rowOf(page, "Underwear")).toContainText("1 per day");
    await expect(rowOf(page, "Socks")).not.toContainText("per day");
    await page.getByRole("button", { name: "Save 2 Staples" }).click();
    await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();

    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: "Staples" })
        .click();
      await expect(page.locator('[data-staple-id="toothbrush"]')).toContainText("per trip");
      await expect(page.locator('[data-staple-id="underwear"]')).toContainText("× 5");
    }
  },
);

test(
  "a revisit keeps a customized quantity through unrelated toggles and a save",
  DEVICE,
  async ({ page }, testInfo) => {
    const ownerId = await openSetup(page, testInfo);
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await editRule(page, rowOf(page, "Underwear"), "3", /^Per day/);
    await expect(rowOf(page, "Underwear")).toContainText("3 per day");
    await page.getByRole("button", { name: "Save 1 Staples" }).click();
    await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();

    // Reopen setup from the reminder with the saved list still in place.
    await setStaplesSetupLifecycle(ownerId, "incomplete");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
    await expect(rowOf(page, "Underwear")).toContainText("3 per day");
    await page.getByRole("checkbox", { name: "Socks" }).check();
    await page.getByRole("checkbox", { name: "Socks" }).uncheck();
    await page.getByRole("checkbox", { name: "Toothbrush" }).check();
    await expect(rowOf(page, "Underwear")).toContainText("3 per day");
    await page.getByRole("button", { name: "Save 2 Staples" }).click();
    await expect(page.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeVisible();
    await page.getByRole("link", { name: "Staples" }).click();
    await expect(page.locator('[data-staple-id="underwear"]')).toContainText("× 13");
    await expect(page.locator('[data-staple-id="toothbrush"]')).toContainText("per trip");
  },
);

test(
  "editing a rule updates the row summary and the Edit name",
  DEVICE,
  async ({ page }, testInfo) => {
    await openSetup(page, testInfo);
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await editRule(page, rowOf(page, "Underwear"), "2", /^Fixed per trip/);
    await expect(rowOf(page, "Underwear")).toContainText("2 per trip");
    await expect(page.getByRole("button", { name: "Edit Underwear, 2 per trip" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Staples setup updates" })).toHaveText(
      "Underwear: 2 per trip.",
    );
  },
);

test("checkbox and Edit names carry the item and its rule", DEVICE, async ({ page }, testInfo) => {
  await openSetup(page, testInfo);
  const underwear = page.getByRole("checkbox", { name: "Underwear" });
  await expect(underwear).toHaveAccessibleDescription("");
  await underwear.check();
  await expect(underwear).toHaveAccessibleDescription("1 per day");
  await expect(page.getByRole("button", { name: "Edit Underwear, 1 per day" })).toBeVisible();
  await underwear.uncheck();
  await expect(underwear).toHaveAccessibleDescription("");
});

type Layout = "inline" | "stacked" | "either";

/** The badge and Edit sit inside the row without overlapping, Edit is a full touch target, nothing is clipped or scrolls. */
async function expectRowSound(row: Locator, layout: Layout, label: string, alignText = false) {
  const name = row.locator(".staple-name strong");
  const badge = row.locator(".staples-setup-rule");
  const edit = row.getByRole("button", { name: /^Edit / });
  await expect(badge, label).toBeVisible();
  const [box, nameBox, badgeBox, editBox] = await Promise.all([
    row.boundingBox(),
    name.boundingBox(),
    badge.boundingBox(),
    edit.boundingBox(),
  ]);
  const inside = (b: { x: number; y: number; width: number; height: number }) =>
    b.x >= box!.x - 1 &&
    b.x + b.width <= box!.x + box!.width + 1 &&
    b.y >= box!.y - 1 &&
    b.y + b.height <= box!.y + box!.height + 1;
  expect(inside(badgeBox!), `${label}: badge inside row`).toBe(true);
  expect(inside(editBox!), `${label}: Edit inside row`).toBe(true);
  expect(editBox!.width, `${label}: Edit width`).toBeGreaterThanOrEqual(44);
  expect(editBox!.height, `${label}: Edit height`).toBeGreaterThanOrEqual(44);
  const overlap =
    badgeBox!.x < editBox!.x + editBox!.width &&
    editBox!.x < badgeBox!.x + badgeBox!.width &&
    badgeBox!.y < editBox!.y + editBox!.height &&
    editBox!.y < badgeBox!.y + badgeBox!.height;
  expect(overlap, `${label}: badge and Edit do not overlap`).toBe(false);
  const clipped = await badge.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped, `${label}: badge text is whole`).toBe(false);
  if (layout === "stacked") {
    if (alignText) {
      // The badge TEXT (box + its own padding) starts where the name text starts.
      const padding = await badge.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
      expect(
        Math.abs(badgeBox!.x + padding - nameBox!.x),
        `${label}: badge text lines up with the name text`,
      ).toBeLessThanOrEqual(3);
    }
    // The name is an inline box, so its rect is the font's content area (ascent + descent), not the line-height. DM Sans's
    // is taller than the Barlow this was written for (1.30em vs 1.20em: about 2.5px at 390@200% text), hence 6, not 3.
    expect(badgeBox!.y, `${label}: badge sits under the name`).toBeGreaterThanOrEqual(
      nameBox!.y + nameBox!.height - 6,
    );
  } else if (layout === "inline") {
    expect(badgeBox!.y, `${label}: badge shares the name line`).toBeLessThan(
      nameBox!.y + nameBox!.height,
    );
  }
  expect(box!.height, `${label}: row keeps its minimum height`).toBeGreaterThanOrEqual(66);
}

const WIDTHS: Array<{ label: string; width: number; layout: Layout }> = [
  { label: "1280", width: 1280, layout: "inline" },
  { label: "390", width: 390, layout: "inline" },
  { label: "320", width: 320, layout: "stacked" },
  // 390px at 200% text lays out like a 195px page. The viewport is 195px wide and the page's 320px floor (#332) is lifted
  // in the test, because that floor is a separate known problem; this test checks the rows, not the whole page.
  { label: "390@200%", width: 195, layout: "stacked" },
];

test(
  "rule summary rows stay whole at 1280, 390, 320 and 390@200% text",
  DEVICE,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openSetup(page, testInfo);
    await page.getByRole("checkbox", { name: "Toothbrush" }).check();
    await page.getByRole("checkbox", { name: "Underwear" }).check();
    await page.getByRole("checkbox", { name: "Travel documents" }).check();
    await page.getByRole("button", { name: /Custom item/ }).click();
    const add = page.getByRole("dialog", { name: "Add a staple" });
    const longName = "Compact travel umbrella with the long wooden handl";
    await add.getByLabel("Item name").fill(longName);
    await add.getByRole("button", { name: "Add staple" }).click();
    const custom = page.locator(".staple-row", { hasText: longName });
    await editRule(page, custom, "30", /^Per day/);
    await expect(custom).toContainText("30 per day");

    for (const { label, width, layout } of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 195) await page.addStyleTag({ content: "body { min-width: 0 !important }" });
      const rows: Array<[string, Locator, Layout]> = [
        ["Toothbrush 1 per trip", rowOf(page, "Toothbrush"), layout],
        ["Underwear 1 per day", rowOf(page, "Underwear"), layout],
        ["Travel documents 1 per trip", rowOf(page, "Travel documents"), layout],
        // The worst case may stack on the phone: the 50-character name leaves no room for the badge.
        ["30 per day custom", custom, label === "390" ? "either" : layout],
      ];
      for (const [name, row, expected] of rows) {
        const state = `${name} at ${label}`;
        if (label === "390" && name.startsWith("Travel documents")) {
          // The name may wrap here, but the badge stays on one line next to Edit.
          await expect(row.locator(".staples-setup-rule"), state).toBeVisible();
          const badgeHeight = (await row.locator(".staples-setup-rule").boundingBox())!.height;
          expect(badgeHeight, `${state}: badge on one line`).toBeLessThan(40);
          continue;
        }
        await expectRowSound(row, expected, state, name !== "30 per day custom");
      }
      if (width <= 320) {
        // A custom row has no checkbox: its name keeps a readable column and the category badge wraps below it.
        const customName = (await custom.locator(".staple-name strong").boundingBox())!;
        const category = (await custom.locator(".staple-name .unit-badge").boundingBox())!;
        expect(customName.width, `custom name width at ${label}`).toBeGreaterThanOrEqual(
          width === 320 ? 80 : 40,
        );
        expect(
          category.y,
          `custom category badge sits under the name at ${label}`,
        ).toBeGreaterThanOrEqual(customName.y + customName.height - 3);
      }
      const unselected = rowOf(page, "Socks");
      await expect(unselected.locator(".staples-setup-rule"), `Socks at ${label}`).toHaveCount(0);
      await expect(unselected.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
      const scrolls = await page
        .locator(".staples-setup")
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(scrolls, `setup screen scrolls sideways at ${label}`).toBe(false);
      if (width >= 320) {
        const pageScrolls = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(pageScrolls, `page scrolls sideways at ${label}`).toBe(false);
      }
    }
  },
);
