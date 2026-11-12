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
  "195px at 200% text: the Upcoming tag stays inside, and the details are a full screen with both actions reachable (#493, #494)",
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
    // A full screen: it covers the page, with nothing of the page left above it.
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(195);
    expect(box.height).toBe(640);
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    for (const name of ["Reuse this list", "Open trip"]) {
      const action = dialog.getByRole("link", { name });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The enlarged lettering stays inside the close-up.
    const close = (await dialog.getByRole("img").first().boundingBox())!;
    const letters = await dialog
      .getByRole("img")
      .first()
      .evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>("span")].map((span) => {
          const r = span.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
    for (const r of letters) {
      expect(r.left).toBeGreaterThanOrEqual(close.x - 1);
      expect(r.right).toBeLessThanOrEqual(close.x + close.width + 1);
    }
  },
);

test("details: a sticker opens a read-only sheet; Escape puts focus back on it (#494)", async ({
  page,
}) => {
  await openStamps(page);
  const lisbon = page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" });
  await lisbon.click();
  const details = page.getByRole("dialog", { name: "Lisbon · Sep 2026" });
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: /Edit stamp label/ })).toHaveCount(0);
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
