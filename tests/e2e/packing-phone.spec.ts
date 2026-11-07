import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { cubeNav, itemRow, openCube } from "./helpers/packing";

// The phone Packing view "Pack mode" (#386), below 1024px: header and counts, the cube bar, the filters and the pencil, the open
// cube in the suitcase, "All in" and "Next", the fixed-height layout and its fallback, and every width band the redesign names
// (390, 320, 195, each at 100% and 200% text; 1023 just under the breakpoint; 1024 for the laptop). The forecast and its review
// rows need the second app: packing-phone-weather.spec.ts. Colour contrast is #377 (exempted per axe call below, nowhere else).
const NOW = new Date("2026-10-16T12:00:00");
const NO_CONTRAST = { disable: ["color-contrast"] };

async function open(page: Page, size = { width: 390, height: 844 }) {
  await page.setViewportSize(size);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const phoneLayout = (page: Page) => page.locator('[data-packing-layout="phone"]');
const tabBar = (page: Page) => page.locator(".bottom-nav");
const allIn = (page: Page) => page.getByRole("button", { name: /^All in/ });

/** Test-only 200% text, the way the other specs do it, waiting until the page really computes it. */
async function zoomText(page: Page) {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeGreaterThanOrEqual(31.9);
}

test(
  "the header has the title, the Laundry toggle and the count, and no back link",
  DEVICE,
  async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Laundry off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByText(/^\d+ of \d+ in the bag$/)).toBeAttached();
    await expect(page.getByRole("link", { name: /All trips/ })).toHaveCount(0);
    const title = (await page.getByRole("heading", { name: "Pack mode", level: 1 }).boundingBox())!;
    const laundry = (await page.getByRole("button", { name: "Laundry off" }).boundingBox())!;
    const count = (await page.getByText(/^\d+ of \d+ in the bag$/).boundingBox())!;
    const middle = (box: typeof title) => box.y + box.height / 2;
    expect(
      Math.abs(middle(title) - middle(laundry)),
      "title and Laundry share one row",
    ).toBeLessThanOrEqual(4);
    expect(
      Math.min(title.y + title.height, count.y + count.height) - Math.max(title.y, count.y),
      "title and total overlap on the same row",
    ).toBeGreaterThan(0);
    expect(count.x, "the total follows the Laundry pill").toBeGreaterThan(
      laundry.x + laundry.width,
    );
    expect(laundry.width, "the canonical Laundry pill is 104px wide").toBeLessThanOrEqual(106);
    // The Trips tab is the way back.
    await expect(tabBar(page).getByRole("link", { name: /Trips/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
);

test("the Laundry toggle is saved and the count follows", DEVICE, async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Laundry off" }).click();
  await expect(page.getByRole("button", { name: "Laundry on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".toast-region")).toContainText(/Laundry on · \d+ items? changed/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Laundry on" })).toBeVisible();
});

test(
  "the cube bar scrolls by itself, marks the open cube, and switching keeps the page still",
  DEVICE,
  async ({ page }) => {
    await open(page);
    const chips = cubeNav(page).getByRole("button");
    await expect(chips.first()).toHaveAttribute("aria-current", "true");
    await expect(cubeNav(page).getByRole("button", { name: /Toiletries/ })).toContainText(
      "Morning of",
    );
    // More chips than fit: the bar scrolls sideways inside itself, the page does not.
    const bar = cubeNav(page).locator("ul");
    expect(await bar.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const last = chips.last();
    await last.click();
    await expect(last).toHaveAttribute("aria-current", "true");
    await expect(chips.first()).not.toHaveAttribute("aria-current", "true");
    // The open cube's chip is scrolled into view.
    const box = (await last.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  },
);

test(
  "filters and the pencil: the pills sit above the suitcase and Edit list works on a phone",
  DEVICE,
  async ({ page }) => {
    await open(page);
    const pills = page.getByRole("group", { name: "Packing list view" });
    const suitcase = page.locator("[data-cube]");
    const pillsBox = (await pills.boundingBox())!;
    const caseBox = (await suitcase.boundingBox())!;
    expect(pillsBox.y + pillsBox.height).toBeLessThanOrEqual(caseBox.y + 1);
    await page.getByRole("button", { name: /^To pack/ }).click();
    await expect(itemRow(page, "sleepwear")).toHaveCount(0);
    await page.getByRole("button", { name: /^All \d/ }).click();
    const pencil = page.getByRole("button", { name: "Edit list" });
    expect((await pencil.boundingBox())!.width).toBeLessThan(60);
    await pencil.click();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(itemRow(page, "underwear").getByRole("button", { name: /^Edit / })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
  },
);

test(
  "Next moves on through the cubes, announces it, and the last one says Done and goes Home",
  DEVICE,
  async ({ page }) => {
    await open(page);
    const names = await cubeNav(page)
      .getByRole("button")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.querySelector("span")?.textContent ?? "").trim()),
      );
    expect(names.length).toBeGreaterThan(2);
    await expect(page.getByRole("button", { name: `Next: ${names[1]}` })).toBeVisible();
    await page.getByRole("button", { name: /^Next: / }).click();
    await expect(page.locator("[data-cube] h2")).toHaveText(names[1]);
    await expect(page.locator("[data-cube] h2")).toBeFocused();
    await expect(page.getByRole("status", { name: "Cube" })).toContainText(`${names[1]},`);
    await cubeNav(page).getByRole("button").last().click();
    const done = page.getByRole("link", { name: "Done" });
    await expect(done).toHaveAttribute("href", "/");
    await done.click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  },
);

test(
  "All in packs the rest of the cube in one change, and it survives a reload",
  DEVICE,
  async ({ page }) => {
    await open(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/trips/"))
        writes.push(request.url());
    });
    const boxes = page.locator("[data-cube] li[data-item-id] input[type=checkbox]");
    const before = await boxes.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).checked),
    );
    expect(before.includes(false)).toBe(true);
    await allIn(page).click();
    await expect(page.locator(".toast-region")).toContainText(/Packed \d+ items/);
    await expect(allIn(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Next: / })).toBeFocused();
    // One write for the whole cube, not one per row.
    expect(writes).toHaveLength(1);
    expect(
      await boxes.evaluateAll((nodes) => nodes.every((node) => (node as HTMLInputElement).checked)),
    ).toBe(true);
    await page.reload();
    expect(
      await page
        .locator("[data-cube] li[data-item-id] input[type=checkbox]")
        .evaluateAll((nodes) => nodes.every((node) => (node as HTMLInputElement).checked)),
    ).toBe(true);
  },
);

test("All in that cannot be saved leaves the cube exactly as it was", DEVICE, async ({ page }) => {
  await open(page);
  const states = () =>
    page
      .locator("[data-cube] li[data-item-id] input[type=checkbox]")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).checked));
  const before = await states();
  await page.route("**/trips/**", (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  await allIn(page).click();
  await expect(page.locator(".toast-region")).toContainText(
    "Couldn’t pack Clothing. Nothing was changed.",
  );
  expect(await states()).toEqual(before);
  await expect(allIn(page)).toBeEnabled();
  await page.unroute("**/trips/**");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await expect(page.locator("[data-cube] li[data-item-id]").first()).toBeVisible();
  expect(await states()).toEqual(before);
});

test(
  "All in after Undo: the toast's Undo restores the partial counts",
  DEVICE,
  async ({ page }) => {
    await open(page);
    const underwear = itemRow(page, "underwear").getByRole("checkbox");
    expect(await underwear.evaluate((box: HTMLInputElement) => box.indeterminate)).toBe(true);
    await allIn(page).click();
    await expect(underwear).toBeChecked();
    await page.locator(".toast-region").getByRole("button", { name: "Undo" }).click();
    await expect(underwear).not.toBeChecked();
    expect(await underwear.evaluate((box: HTMLInputElement) => box.indeterminate)).toBe(true);
  },
);

// ---- the fixed-height layout and its fallback ----------------------------------------------------------------------------

test(
  "390x844: the action bar sits just above the tab bar, and the list scrolls inside the suitcase",
  DEVICE,
  async ({ page }) => {
    await open(page, { width: 390, height: 844 });
    await expect(phoneLayout(page)).not.toHaveAttribute("data-zoomed", "true");
    const action = (await allIn(page).boundingBox())!;
    const tabs = (await tabBar(page).boundingBox())!;
    expect(action.y + action.height).toBeLessThanOrEqual(tabs.y);
    expect(tabs.y - (action.y + action.height)).toBeLessThanOrEqual(40);
    // Clothing has more rows than fit: the list scrolls inside the suitcase.
    const list = page.locator("[data-cube] ul").first();
    const scrolls = await list.evaluate((node) => ({
      inner: node.scrollHeight > node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(scrolls).toEqual({ inner: true, overflowY: "auto" });
    // The suitcase is at least 220px tall.
    expect((await page.locator("[data-cube]").boundingBox())!.height).toBeGreaterThanOrEqual(200);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  },
);

test(
  "390x600: a short phone falls back to natural flow with a sticky action bar",
  DEVICE,
  async ({ page }) => {
    await open(page, { width: 390, height: 600 });
    const tabs = (await tabBar(page).boundingBox())!;
    const bar = async () => (await allIn(page).boundingBox())!;
    for (const y of [0, 300, 100000]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      const box = await bar();
      expect(box.y + box.height, `scrolled to ${y}`).toBeLessThanOrEqual(tabs.y + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    // The list is in the page flow here: it does not scroll by itself.
    const list = page.locator("[data-cube] ul").first();
    expect(
      await list.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeLessThanOrEqual(1);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  },
);

test(
  "390x640 boundary: the fixed-height layout starts and the suitcase list scrolls inside",
  DEVICE,
  async ({ page }) => {
    await open(page, { width: 390, height: 640 });
    await expect(phoneLayout(page)).not.toHaveAttribute("data-zoomed", "true");
    const action = (await allIn(page).boundingBox())!;
    const tabs = (await tabBar(page).boundingBox())!;
    expect(action.y + action.height).toBeLessThanOrEqual(tabs.y + 1);
    const list = page.locator("[data-cube] ul").first();
    const scrolls = await list.evaluate((node) => ({
      inner: node.scrollHeight > node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(scrolls).toEqual({ inner: true, overflowY: "auto" });
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  },
);

test(
  "200% text at 390: natural flow, the rows grow, nothing is cut off or scrolls sideways",
  DEVICE,
  async ({ page }) => {
    await open(page);
    await zoomText(page);
    await expect(phoneLayout(page)).toHaveAttribute("data-zoomed", "true");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const list = page.locator("[data-cube] ul").first();
    expect(
      await list.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeLessThanOrEqual(1);
    const box = (await allIn(page).boundingBox())!;
    const tabs = (await tabBar(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y + 1);
    await expect(page.getByRole("button", { name: /^Next: / })).toBeVisible();
  },
);

for (const size of [
  { width: 320, height: 568 },
  { width: 195, height: 640 },
]) {
  for (const zoom of [false, true]) {
    test(
      `${size.width}px${zoom ? " at 200% text" : ""}: nothing scrolls sideways, every control is reachable`,
      DEVICE,
      async ({ page }) => {
        await open(page, size);
        if (zoom) await zoomText(page);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.getByRole("button", { name: "Edit list" }).click();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.getByRole("button", { name: "Done", exact: true }).click();
        for (const control of [
          page.getByRole("button", { name: /^Laundry/ }),
          page.getByRole("button", { name: /^To pack/ }),
          allIn(page),
          page.getByRole("button", { name: /^Next: / }),
        ]) {
          await control.scrollIntoViewIfNeeded();
          const box = (await control.boundingBox())!;
          expect(box.x, "not cut off on the left").toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width, "not cut off on the right").toBeLessThanOrEqual(size.width + 1);
        }
        // The title and the Laundry pill never overlap: the header wraps instead.
        const title = (await page.getByRole("heading", { name: "Pack mode" }).boundingBox())!;
        const laundry = (await page.getByRole("button", { name: /^Laundry/ }).boundingBox())!;
        const overlap =
          title.x < laundry.x + laundry.width &&
          laundry.x < title.x + title.width &&
          title.y < laundry.y + laundry.height &&
          laundry.y < title.y + title.height;
        expect(overlap).toBe(false);
        if (size.width === 195 && zoom) {
          const skip = page.getByRole("link", { name: "Skip to main content" });
          const hidden = (await skip.boundingBox())!;
          expect(
            hidden.y + hidden.height,
            "the unfocused skip link is fully offscreen",
          ).toBeLessThanOrEqual(0);
          await skip.focus();
          const shown = (await skip.boundingBox())!;
          expect(shown.y, "the focused skip link is visible").toBeGreaterThanOrEqual(0);
          expect(shown.x + shown.width).toBeLessThanOrEqual(size.width + 1);
        }
      },
    );
  }
}

// Words in the open cube (its title and every item name) are never split across lines, and a wrapped row grows instead of
// overlapping the next one. A hyphen counts as a boundary too ("Nice-attire" may wrap after it). A DOM Range per word reports one client rect per line the word occupies: two means a mid-word break.
async function brokenWords(page: Page): Promise<string[]> {
  return page.locator("[data-cube]").evaluate((cube) => {
    const broken: string[] = [];
    const targets = [
      cube.querySelector("h2"),
      ...Array.from(cube.querySelectorAll("li[data-item-id] span")),
    ];
    for (const target of targets) {
      if (!target) continue;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        for (const match of text.matchAll(/[^\s-]+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          const lines = new Set(
            Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
          );
          if (lines.size > 1) broken.push(match[0]);
        }
      }
    }
    return broken;
  });
}

for (const zoom of [false, true]) {
  test(
    `195px${zoom ? " at 200% text" : ""}: the cube list breaks only between words, and rows grow instead of overlapping`,
    DEVICE,
    async ({ page }) => {
      await open(page, { width: 195, height: 640 });
      if (zoom) await zoomText(page);
      expect(await brokenWords(page), "words split across lines").toEqual([]);
      const rows = page.locator("[data-cube] li[data-item-id]");
      expect(await rows.count()).toBeGreaterThan(3);
      const boxes = await rows.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, right: rect.right };
        }),
      );
      for (let index = 1; index < boxes.length; index++)
        expect(
          boxes[index].top,
          `row ${index} starts below row ${index - 1}`,
        ).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 1);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    },
  );
}

test(
  "390 at 200% text with Edit list open: rows wrap and never overflow",
  DEVICE,
  async ({ page }) => {
    await open(page);
    await zoomText(page);
    await page.getByRole("button", { name: "Edit list" }).click();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const row = (await itemRow(page, "underwear").boundingBox())!;
    expect(row.x + row.width).toBeLessThanOrEqual(391);
  },
);

test("1023px is the phone layout and 1024px the laptop one, which is unchanged", async ({
  page,
}) => {
  await open(page, { width: 1023, height: 900 });
  await expect(phoneLayout(page)).toHaveCount(1);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await expect(page.locator('[data-packing-layout="laptop"]')).toHaveCount(1);
  await expect(phoneLayout(page)).toHaveCount(0);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  // The phone layout is back below the line, with the same cube open and nothing lost.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(phoneLayout(page)).toHaveCount(1);
});

test("601 to 1023px: the phone layout stays in a column capped at 640px", async ({ page }) => {
  await open(page, { width: 900, height: 900 });
  const box = (await phoneLayout(page).boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(641);
});

test(
  "the Pack mode screen is accessible, in default, Edit list and the toiletry prompt",
  DEVICE,
  async ({ page }) => {
    await open(page);
    await expectAccessible(page, "pack mode", NO_CONTRAST);
    await page.getByRole("button", { name: "Edit list" }).click();
    await expectAccessible(page, "pack mode edit list", NO_CONTRAST);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openCube(page, "Toiletries");
    await expectAccessible(page, "pack mode toiletries", NO_CONTRAST);
  },
);

test("keyboard: the cube bar, the checklist, All in and Next are all reachable and operable", async ({
  page,
}) => {
  await open(page);
  const toiletries = cubeNav(page).getByRole("button", { name: /Toiletries/ });
  await toiletries.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-cube] h2")).toBeFocused();
  // Back to Clothing (no bag prompt there), then on with the checklist.
  const clothing = cubeNav(page).getByRole("button", { name: /^Clothing/ });
  await clothing.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-cube] h2")).toHaveText("Clothing");
  const first = page.locator("[data-cube] input[type=checkbox]").first();
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toBeChecked();
  await allIn(page).focus();
  await page.keyboard.press("Enter");
  await expect(allIn(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Next: / })).toBeFocused();
});
