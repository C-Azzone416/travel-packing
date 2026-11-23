import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

const NOW = new Date("2026-10-16T12:00:00");

async function openStamps(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.goto("/stamps");
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past trips", level: 2 })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const overflowingElements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${element.className}`,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        };
      })
      .filter(({ left, right }) => left < 0 || right > document.documentElement.clientWidth)
      .slice(0, 12),
  );

test("the sticker suitcase is data-backed and selects trips without changing them", async ({
  page,
}) => {
  await openStamps(page);
  await expect(page.getByText("1 inked")).toBeVisible();
  const lisbon = page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip", exact: true });
  const sanDiego = page.getByRole("button", {
    name: "San Diego, Oct 2026, upcoming, not inked yet",
    exact: true,
  });
  await expect(lisbon).toHaveAttribute("aria-pressed", "true");
  await expect(sanDiego).toHaveAttribute("data-upcoming", "true");
  await expect(page.getByLabel("Travel totals").getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Selected trip: Lisbon" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Selected trip: Lisbon" }).locator("[data-colour]"),
  ).toHaveAttribute("data-colour", "good");
  await expect(page.getByRole("link", { name: "Reuse this list" })).toHaveAttribute(
    "href",
    /\/trips\/new\?copy=/,
  );
  await sanDiego.focus();
  await page.keyboard.press("Enter");
  // A sticker opens its details as well as selecting it (#494).
  await expect(page.getByRole("dialog", { name: "San Diego · Oct 2026" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sanDiego).toBeFocused();
  await expect(page.getByRole("article", { name: "Selected trip: San Diego" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open trip" })).toHaveAttribute("href", /\/trips\//);
  await page.reload();
  await expect(page.getByText("1 inked")).toBeVisible();
});

test("the filters update the archive, keyboard state and accessible name", async ({ page }) => {
  await openStamps(page);
  const year = page.getByRole("button", { name: "2026", exact: true });
  await year.focus();
  await page.keyboard.press("Enter");
  await expect(year).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Stickers · 2026")).toBeVisible();
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page.getByText("Stickers · All time")).toBeVisible();
  // #377 tracks the accepted palette's known contrast exceptions; every other WCAG check remains enabled.
  await expectAccessible(page, "Stamps suitcase", { disable: ["color-contrast"] });
});

test(
  "phone and 195px stress widths keep every action reachable with no page overflow",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 195, height: 640 });
    await openStamps(page);
    expect(await sideways(page), JSON.stringify(await overflowingElements(page), null, 2)).toBe(0);
    await expect(page.getByRole("button", { name: "Last 12 months" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Lisbon, Sep 2026, inked, 1 trip/ }),
    ).toBeVisible();
    await page.getByRole("heading", { name: "Past trips" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Reuse this list" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open trip" })).toBeVisible();
    expect(await sideways(page), JSON.stringify(await overflowingElements(page), null, 2)).toBe(0);
  },
);

test("focused review screenshots", DEVICE, async ({ page }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await openStamps(page);
  await page.evaluate(
    (scheme) => document.documentElement.setAttribute("data-scheme", scheme),
    phone ? "evergreen" : "ocean",
  );
  await page.screenshot({
    path: `test-results/screenshots/stamps-${phone ? "evergreen-390" : "ocean-1280"}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 195, height: 640 });
  await page.evaluate(() => document.documentElement.setAttribute("data-scheme", "dusk"));
  await page.screenshot({
    path: `test-results/screenshots/stamps-dusk-195-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

const rgb = (page: Page, variable: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, variable);

test("an upcoming sticker stays dashed and unfilled when selected, and selection is not gold (#493)", async ({
  page,
}) => {
  await openStamps(page);
  const lisbon = page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" });
  const sanDiego = page.getByRole("button", {
    name: "San Diego, Oct 2026, upcoming, not inked yet",
  });
  // Nothing upcoming is selected at first paint; the earned sticker is.
  await expect(lisbon).toHaveAttribute("aria-pressed", "true");
  await expect(sanDiego).toHaveAttribute("aria-pressed", "false");
  await sanDiego.click();
  await page.keyboard.press("Escape");
  await expect(sanDiego).toHaveAttribute("aria-pressed", "true");
  await expect(sanDiego).toHaveCSS("border-top-style", "dashed");
  await expect(sanDiego).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(sanDiego.getByText("Upcoming", { exact: true })).toBeVisible();
  const gold = await rgb(page, "--gold");
  expect(await sanDiego.evaluate((node) => getComputedStyle(node).boxShadow)).not.toContain(gold);
  expect(await lisbon.evaluate((node) => getComputedStyle(node).boxShadow)).not.toContain(gold);
  // Earned stays solid, with no tag.
  await expect(lisbon).toHaveCSS("border-top-style", "solid");
  await expect(lisbon.getByText("Upcoming", { exact: true })).toHaveCount(0);
});

test("forced colours: upcoming and earned stickers differ in border style and colour (#493)", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openStamps(page);
  const earned = page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" });
  const upcoming = page.getByRole("button", {
    name: "San Diego, Oct 2026, upcoming, not inked yet",
  });
  const style = (node: typeof earned) =>
    node.evaluate((element) => {
      const css = getComputedStyle(element);
      return { style: css.borderTopStyle, colour: css.borderTopColor };
    });
  const [a, b] = [await style(earned), await style(upcoming)];
  expect(a.style).not.toBe(b.style);
  expect(a.colour).not.toBe(b.colour);
});

test(
  "195px at 200% text: the Upcoming tag stays inside, and both details actions are reachable (#493, #494)",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 195, height: 640 });
    await openStamps(page);
    const doubleText = (selector: string) =>
      page.evaluate((root) => {
        const all = [...document.querySelectorAll<HTMLElement>(`${root}, ${root} *`)];
        const sizes = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
        all.forEach((el, at) =>
          el.style.setProperty("font-size", `${sizes[at] * 2}px`, "important"),
        );
      }, selector);
    await doubleText("main");
    const upcoming = page.getByRole("button", {
      name: "San Diego, Oct 2026, upcoming, not inked yet",
    });
    const tag = upcoming.getByText("Upcoming", { exact: true });
    await tag.scrollIntoViewIfNeeded();
    const [sticker, label] = [(await upcoming.boundingBox())!, (await tag.boundingBox())!];
    expect(sticker.width).toBeGreaterThanOrEqual(96);
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(195);
    expect(label.width).toBeLessThanOrEqual(sticker.width);
    await upcoming.click();
    const dialog = page.getByRole("dialog", { name: "San Diego · Oct 2026" });
    await expect(dialog).toBeVisible();
    await doubleText('[role="dialog"]');
    await page.evaluate(() => document.documentElement.setAttribute("data-scheme", "ocean"));
    const title = dialog.getByRole("heading");
    const close = dialog.getByRole("button", { name: "Close" });
    await title.scrollIntoViewIfNeeded();
    const titleBox = (await title.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.x).toBeGreaterThanOrEqual(0);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(195);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
    for (const name of ["Reuse this list", "Open trip"]) {
      const action = dialog.getByRole("link", { name });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  },
);

test("details: a sticker opens a sheet with Edit stamp label; Escape puts focus back on it (#494)", async ({
  page,
}) => {
  await openStamps(page);
  const lisbon = page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" });
  await lisbon.click();
  const details = page.getByRole("dialog", { name: "Lisbon · Sep 2026" });
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: "Edit stamp label" })).toBeVisible();
  // Focus starts on the title, so the next Enter does not navigate.
  await expect(details.getByRole("heading", { name: "Lisbon · Sep 2026" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(lisbon).toBeFocused();
  // The selected sticker opens it again.
  await lisbon.click();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(lisbon).toBeFocused();
});

// Real same-document history: Back dismisses details before ordinary route navigation (#557).
test(
  "history: Back preserves the selected sticker, nonzero scroll and opener",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await openStamps(page);
    const sticker = page.getByRole("button", {
      name: "San Diego, Oct 2026, upcoming, not inked yet",
      exact: true,
    });
    await sticker.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 150));
    const before = await page.evaluate(() => ({
      state: history.state,
      length: history.length,
      scroll: scrollY,
    }));
    expect(before.scroll).toBe(150);
    // Instrument the actual focus calls without changing their behavior.
    await sticker.evaluate((node: HTMLElement) => {
      const focus = HTMLElement.prototype.focus;
      const calls: (FocusOptions | undefined)[] = [];
      HTMLElement.prototype.focus = function (options) {
        if (this === node) {
          calls.push(options);
          node.dataset.focusCalls = JSON.stringify(calls);
        }
        return focus.call(this, options);
      };
      node.focus({ preventScroll: true });
    });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    const opened = await page.evaluate(() => ({ state: history.state, length: history.length }));
    expect(opened.length).toBe(before.length + 1);
    expect(opened.state).toMatchObject(before.state);
    await page.goBack();
    await expect(page).toHaveURL(/\/stamps$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(sticker).toBeFocused();
    await expect(sticker).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article", { name: "Selected trip: San Diego" })).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(before.scroll);
    await page.goForward();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await historyClosed(page);
    await expect(sticker).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(before.scroll);
    const focusCalls = JSON.parse(
      (await sticker.getAttribute("data-focus-calls")) ?? "[]",
    ) as FocusOptions[];
    expect(focusCalls.length).toBeGreaterThanOrEqual(4);
    expect(focusCalls.every((options) => options?.preventScroll === true)).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  },
);

const historySticker = (p: Page) =>
  p.getByRole("button", { name: "San Diego, Oct 2026, upcoming, not inked yet", exact: true });
const historyDetails = (p: Page) =>
  p.getByRole("dialog", { name: "San Diego · Oct 2026", exact: true });
const historyClosed = async (p: Page) => {
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.locator("body")).not.toHaveAttribute("data-sheet-open");
};
const historySnapshot = async (p: Page, label: string) => {
  const data = await p.evaluate(() => ({
    url: location.href,
    state: history.state,
    length: history.length,
  }));
  await test
    .info()
    .attach(label, { body: JSON.stringify(data, null, 2), contentType: "application/json" });
  return data;
};
test.describe("owned stamp history", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAsOwner(page);
  });
  test(
    "history: repeated activation pending close Escape reopen creates one active entry",
    DEVICE,
    async ({ page }) => {
      await page.goto("/stamps");
      await expect(historySticker(page)).toBeVisible();
      const before = await historySnapshot(page, "before");
      await historySticker(page).evaluate((n: HTMLElement) => {
        n.click();
        n.click();
        n.click();
      });
      await expect(historyDetails(page)).toBeVisible();
      expect((await historySnapshot(page, "triple-open")).length).toBe(before.length + 1);
      await historyDetails(page)
        .getByRole("button", { name: "Close dialog" })
        .evaluate((n: HTMLElement) => {
          n.click();
          n.click();
          n.click();
        });
      await historyClosed(page);
      await expect(page).toHaveURL(/\/stamps$/);
      await historySticker(page).click();
      const firstKey = (await historySnapshot(page, "first-key")).state.packingStampDetails.key;
      // Background is inert: stress a different activation before any close traversal completes.
      await page
        .getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" })
        .evaluate((node: HTMLElement) => node.click());
      await expect(page.getByRole("dialog", { name: "Lisbon · Sep 2026" })).toBeVisible();
      const changed = await historySnapshot(page, "changed-key");
      expect(changed.length).toBe(before.length + 1);
      expect(changed.state.packingStampDetails.key).not.toBe(firstKey);
      await page.goBack();
      await historyClosed(page);
      await page.goForward();
      await expect(page.getByRole("dialog", { name: "Lisbon · Sep 2026" })).toBeVisible();
      await page.keyboard.press("Escape");
      await historyClosed(page);
      for (let i = 0; i < 3; i++) {
        await historySticker(page).click();
        await expect(historyDetails(page)).toBeVisible();
        await page.keyboard.press("Escape");
        await historyClosed(page);
        await expect(historySticker(page)).toBeFocused();
      }
      await historySticker(page).click();
      await page.goBack();
      await historyClosed(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await historySnapshot(page, "ordinary-back");
    },
  );
  test(
    "history: label editor handoff cancel then Forward and back are serialized",
    DEVICE,
    async ({ page }) => {
      await page.goto("/stamps");
      await expect(historySticker(page)).toBeVisible();
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      await historyDetails(page).getByRole("button", { name: "Edit stamp label" }).click();
      const editor = page.getByRole("dialog", { name: "Stamp label", exact: true });
      await expect(editor).toBeVisible();
      await expect(historyDetails(page)).toHaveCount(0);
      expect((await historySnapshot(page, "editor")).state.packingStampDetails).toBeUndefined();
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await historyClosed(page);
      await expect(historySticker(page)).toBeFocused();
      await page.goForward();
      await expect(historyDetails(page)).toBeVisible();
      await page.goBack();
      await historyClosed(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await historySnapshot(page, "ordinary-back");
    },
  );
  test(
    "history: details Open trip route leave and obsolete entry on Back stay inert",
    DEVICE,
    async ({ page }) => {
      await page.goto("/stamps");
      await expect(historySticker(page)).toBeVisible();
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      const old = await historySnapshot(page, "old-instance");
      await historyDetails(page).getByRole("link", { name: "Open trip", exact: true }).click();
      await expect(page).toHaveURL(/\/trips\/[^/?]+$/);
      await historyClosed(page);
      await historySnapshot(page, "route");
      await page.goBack();
      await expect(page).toHaveURL(/\/stamps$/);
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      expect((await historySnapshot(page, "obsolete-back")).state.packingStampDetails?.owner).toBe(
        old.state.packingStampDetails.owner,
      );
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      const fresh = await historySnapshot(page, "fresh-instance");
      expect(fresh.state.packingStampDetails.owner).not.toBe(old.state.packingStampDetails.owner);
      await page.goBack();
      await historyClosed(page);
      await page.goForward();
      await expect(historyDetails(page)).toBeVisible();
      await historySnapshot(page, "fresh-forward");
    },
  );
  test(
    "history: details Reuse link leaves cleanly and normal Next history resumes",
    DEVICE,
    async ({ page }) => {
      await page.goto("/stamps");
      await expect(historySticker(page)).toBeVisible();
      await historySticker(page).click();
      await historyDetails(page)
        .getByRole("link", { name: "Reuse this list", exact: true })
        .click();
      await expect(page).toHaveURL(/\/trips\/new\?copy=/);
      await historyClosed(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/stamps$/);
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      await historySnapshot(page, "obsolete-reuse-back");
      await page.goBack();
      await expect(page).toHaveURL(/\/stamps$/);
      await historyClosed(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
    },
  );
  test(
    "history: phone Home switch while details open unmount remount obsolete traversal",
    DEVICE,
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const stampsTab = page.getByRole("tab", { name: /^Stamps/ });
      await stampsTab.click();
      await expect(historySticker(page)).toBeVisible();
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      await historySnapshot(page, "home-open");
      // The modal makes tabs inert. Inject the existing tab click to exercise external view teardown while open.
      await page.locator("#home-tab-weather").evaluate((n: HTMLElement) => n.click());
      await expect(page).toHaveURL(/tab=weather/);
      await historyClosed(page);
      await historySnapshot(page, "switched-weather");
      await page.goBack();
      await expect(page).toHaveURL(/tab=stamps/);
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      await historySnapshot(page, "obsolete-home-back");
      await page.goForward();
      await expect(page).toHaveURL(/tab=weather/);
      await historyClosed(page);
      await page.goBack();
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      await page.goBack();
      await historyClosed(page);
      await expect(historySticker(page)).toBeFocused();
      await page.goForward();
      await expect(historyDetails(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await historyClosed(page);
      await historySnapshot(page, "remounted-active");
    },
  );
  test(
    "history: external route leave while open and reload never resurrect stale dialog",
    DEVICE,
    async ({ page }) => {
      await page.goto("/stamps");
      await expect(historySticker(page)).toBeVisible();
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      // Exercise an already-authorized app route event despite the inert background.
      const home = page.locator('a[href="/"]:visible').first();
      await home.evaluate((n: HTMLElement) => n.click());
      await expect(page).toHaveURL(/\/$/);
      await historyClosed(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/stamps$/);
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      await historySticker(page).click();
      await expect(historyDetails(page)).toBeVisible();
      await page.reload();
      await expect(historySticker(page)).toBeVisible();
      await historyClosed(page);
      await historySnapshot(page, "reload-obsolete");
      await page.goBack();
      await historyClosed(page);
      await page.goForward();
      await historyClosed(page);
      await historySnapshot(page, "reload-forward-inert");
    },
  );
  test(
    "history: narrow invalid sticker marker is inert for same live instance",
    DEVICE,
    async ({ page }) => {
      for (const embedded of [false, true]) {
        if (embedded) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.goto("/");
          await page.getByRole("tab", { name: /^Stamps/ }).click();
        } else await page.goto("/stamps");
        await expect(historySticker(page)).toBeVisible();
        await historySticker(page).click();
        await expect(historyDetails(page)).toBeVisible();
        const before = await historySnapshot(page, `valid-marker-${embedded}`);
        // Fault injection represents a marker whose referenced sticker is absent from this live view.
        await page.evaluate(() =>
          history.replaceState(
            {
              ...history.state,
              packingStampDetails: {
                ...history.state.packingStampDetails,
                key: "absent-proof-sticker",
              },
            },
            "",
            location.href,
          ),
        );
        await page.goBack();
        await historyClosed(page);
        await page.goForward();
        await historyClosed(page);
        const after = await historySnapshot(page, `invalid-forward-${embedded}`);
        expect(after.state.packingStampDetails.owner).toBe(before.state.packingStampDetails.owner);
      }
    },
  );
});
