import { appendFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, setupEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { resetStaplesSetup, seedSavedList } from "./helpers/database";
import { DEVICE } from "./helpers/device";
import { expectFits } from "./helpers/overflow";
import { chooseFromMenu } from "./helpers/menu";

// #332: no sideways scroll and nothing clipped at 195px (200% zoom of a 390px phone) and 160px, on every screen; 320, 390 and
// 1280 stay as they were. The page-level check alone is not enough (an `overflow: hidden` card hides what spills out of it), so
// every page is also swept for visible elements that stick out of the viewport, and the hardest components get rect checks.
// SCREENSHOTS=<folder> saves a picture of each page and state for design review (unset in CI).
const NOW = new Date("2026-10-16T12:00:00");
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

/** Narrow widths run on the phone (WebKit) as well, except 160, which no phone reaches; the wide ones run on desktop only. */
const NARROW = [160, 195, 320] as const;
const UNCHANGED = [390, 1280] as const;
const tagFor = (width: number) => (width === 160 || width >= 700 ? {} : DEVICE);
const heightFor = (width: number) => (width < 700 ? 422 : 900);

async function resize(page: Page, width: number) {
  if (process.env.NARROW_CSS) {
    const css = process.env.NARROW_CSS;
    await page.addInitScript((text) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = text;
        document.head.append(style);
      });
    }, css);
  }
  await page.setViewportSize({ width, height: heightFor(width) });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

// Ids and the reset token vary per run: a screenshot name must not.
const slug = (text: string) =>
  text
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "id")
    .replace(/token=a+/, "token")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");

async function visit(page: Page, path: string, width: number) {
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible();
  await expectFits(page, `${path} at ${width}px`, `${width}-${slug(path)}`);
}

for (const width of [...NARROW, ...UNCHANGED]) {
  test(`signed-out pages fit at ${width}px`, tagFor(width), async ({ page }) => {
    await resize(page, width);
    for (const path of [
      "/sign-in",
      "/sign-in?notice=password-updated",
      "/sign-up",
      "/forgot-password",
      "/verify",
      `/reset-password?token=${"a".repeat(48)}`,
      "/access-denied",
      "/close-account/complete",
    ]) {
      await visit(page, path, width);
    }
    // "Show password" sits in the field's row: the row, the field and the toggle all stay inside the viewport.
    await page.goto("/sign-in");
    const toggle = page.getByRole("button", { name: /Show password/ });
    await toggle.click();
    const field = (await page.getByLabel("Password", { exact: true }).boundingBox())!;
    const button = (await toggle.boundingBox())!;
    expect(field.x + field.width).toBeLessThanOrEqual(width + 0.5);
    expect(button.x + button.width).toBeLessThanOrEqual(width + 0.5);
    expect(button.x).toBeGreaterThanOrEqual(0);
    if (width < 180)
      expect(button.y, "the toggle drops below the field").toBeGreaterThanOrEqual(
        field.y + field.height - 1,
      );
    else expect(button.y, "beside the field above 180px").toBeLessThan(field.y + field.height);
  });
}

async function openDashboard(page: Page, width: number) {
  await page.clock.setFixedTime(NOW);
  await resize(page, width);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

for (const width of [...NARROW, ...UNCHANGED]) {
  test(`signed-in pages fit at ${width}px`, tagFor(width), async ({ page }) => {
    test.setTimeout(120_000);
    await openDashboard(page, width);
    await expectFits(page, `/ at ${width}px`, `${width}-dashboard`);
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await expect(page.getByRole("link", { name: "Review bag: Lisbon" })).toBeVisible();
    await expectFits(page, `/ past tab at ${width}px`, `${width}-dashboard-past`);

    const listId = await seedSavedList(ownerId(), "Beach week with a long name", [
      { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
      { id: "shorts", name: "Shorts", category: "Clothing", qty: 3 },
      { id: "brush", name: "Toothbrush", category: "Bathroom", qty: 1 },
    ]);
    for (const path of [
      "/trips/new",
      "/staples",
      "/staples/lists",
      `/staples/lists/${listId}`,
      "/settings",
      "/close-account",
    ]) {
      await visit(page, path, width);
    }
    // The trip page and its review: reached by the link, the way a person does.
    await page.goto("/");
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
    await expectFits(page, `trip at ${width}px`, `${width}-trip`);
    const id = new URL(page.url()).pathname.split("/").pop();
    await visit(page, `/trips/${id}/review`, width);
    await page.goto("/trips/nope");
    await expectFits(page, `missing trip at ${width}px`, `${width}-missing-trip`);
  });
}

for (const width of NARROW) {
  test(`the create flow fits at ${width}px, every step`, tagFor(width), async ({ page }) => {
    test.setTimeout(120_000);
    await openDashboard(page, width);
    await seedSavedList(ownerId(), "Beach week", [
      { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    ]);
    await page.getByRole("link", { name: /Plan a trip/ }).click();
    await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
    await expectFits(page, `create: empty form at ${width}px`, `${width}-create-empty`);
    await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
    await page
      .getByRole("option", { name: /Lisbon/ })
      .first()
      .click();
    await page.getByLabel("Leave", { exact: true }).fill("2027-03-01");
    await page.getByLabel("Return", { exact: true }).fill("2027-03-05");
    await expectFits(page, `create: destination chosen at ${width}px`, `${width}-create-chosen`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Start from a saved list", level: 1 }),
    ).toBeVisible();
    await expectFits(page, `create: saved list step at ${width}px`, `${width}-create-lists`);
    await page
      .getByRole("radiogroup", { name: "Starting point" })
      .getByRole("button", { name: "Preview items in Beach week" })
      .click();
    await expectFits(page, `create: list preview at ${width}px`, `${width}-create-preview`);
    await page.goto("/trips/new");
    await page.getByRole("button", { name: "+ Add another stop" }).click();
    await expect(page.getByRole("combobox", { name: "Destination search, Stop 2" })).toBeVisible();
    await expectFits(page, `create: two stops at ${width}px`, `${width}-create-stops`);
  });
}

for (const width of NARROW) {
  test(`first-use Staples setup fits at ${width}px`, tagFor(width), async ({ page }, testInfo) => {
    const email = setupEmailFor(testInfo.project.name);
    await resetStaplesSetup(`e2e-${email}`);
    await resize(page, width);
    await signIn(page, email);
    await expect(page.getByRole("heading", { name: "Build your Staples" })).toBeVisible();
    await expectFits(page, `staples setup at ${width}px`, `${width}-staples-setup`);
  });
}

async function openPast(page: Page, width: number) {
  await openDashboard(page, width);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await expect(page.getByRole("link", { name: "Review bag: Lisbon" })).toBeVisible();
}

const cardGeometry = (card: Locator) =>
  card.evaluate((el) => {
    const title = el.querySelector("h2")!;
    const chip = el.querySelector(".trip-top .status-pill")!;
    const box = (node: Element) => node.getBoundingClientRect().toJSON();
    return {
      card: box(el),
      title: box(title),
      chip: box(chip),
      titleClipped: title.scrollWidth - title.clientWidth,
      chipClipped: chip.scrollWidth - chip.clientWidth,
      lines:
        title.getBoundingClientRect().height /
        (parseFloat(getComputedStyle(title).lineHeight) ||
          parseFloat(getComputedStyle(title).fontSize) * 1.2),
    };
  });

for (const width of [...NARROW, 390] as const) {
  test(
    `a long unbroken trip title keeps the chip in the card at ${width}px`,
    tagFor(width),
    async ({ page }) => {
      await openPast(page, width);
      const card = page.locator(".trip-card");
      const normal = await cardGeometry(card);
      // A normal title: at 390 and wider the chip sits beside it, as before.
      if (width >= 390) {
        expect(normal.chip.left, "beside the title").toBeGreaterThanOrEqual(
          normal.title.right - 0.5,
        );
      }
      await card
        .locator("h2")
        .evaluate((el) => (el.textContent = "Supercalifragilisticexpialidocious"));
      const long = await cardGeometry(card);
      expect(long.chip.right, "chip inside the card").toBeLessThanOrEqual(long.card.right + 0.5);
      expect(long.chip.left).toBeGreaterThanOrEqual(long.card.left - 0.5);
      expect(long.title.right, "title inside the card").toBeLessThanOrEqual(long.card.right + 0.5);
      if (width >= 390) {
        const apart =
          long.chip.left >= long.title.right - 0.5 || long.chip.top >= long.title.bottom - 0.5;
        expect(apart, "the title and chip rects do not intersect").toBe(true);
      } else {
        expect(long.chip.top, "stacked under the title").toBeGreaterThanOrEqual(
          long.title.bottom - 0.5,
        );
      }
      expect(long.titleClipped, "title not truncated").toBeLessThanOrEqual(0);
      expect(long.chipClipped, "chip not truncated").toBeLessThanOrEqual(0);
      expect(long.lines, "the title is at least one line").toBeGreaterThanOrEqual(1);
      await expectFits(page, `long title card at ${width}px`, `${width}-long-title`);
    },
  );
}

for (const width of NARROW) {
  test(
    `a sheet fits and its buttons are reachable at ${width}px`,
    tagFor(width),
    async ({ page }) => {
      await openPast(page, width);
      await page.getByRole("button", { name: "Remove: Lisbon" }).click();
      const sheet = page.getByRole("dialog", { name: "Remove Lisbon?" });
      await expect(sheet).toBeVisible();
      const buttons = await sheet.getByRole("button").evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            name: node.textContent,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
          };
        }),
      );
      expect(buttons.length).toBeGreaterThan(1);
      for (const button of buttons) {
        expect(button.left, button.name ?? "").toBeGreaterThanOrEqual(0);
        expect(button.right, button.name ?? "").toBeLessThanOrEqual(width + 0.5);
        expect(button.bottom, button.name ?? "").toBeLessThanOrEqual(heightFor(width) + 0.5);
      }
      await expectFits(page, `sheet at ${width}px`, `${width}-sheet`);
    },
  );
}

for (const width of NARROW.filter((entry) => entry < 721)) {
  test(`the tab bar and top bar are reachable at ${width}px`, tagFor(width), async ({ page }) => {
    await openDashboard(page, width);
    const items = page.locator(".bottom-nav a, .bottom-nav button");
    expect(await items.count()).toBe(4);
    const facts = await items.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          label: (node.textContent ?? "").trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          hit: hit !== null && node.contains(hit),
          clipped: node.scrollWidth - node.clientWidth,
          lines: (() => {
            const range = document.createRange();
            const label = Array.from(node.childNodes).find(
              (child) => child.nodeType === 3 && (child.textContent ?? "").trim(),
            );
            if (!label) return 0;
            range.selectNodeContents(label);
            return new Set(Array.from(range.getClientRects(), (box) => Math.round(box.top))).size;
          })(),
        };
      }),
    );
    for (const item of facts) {
      expect(item.left, item.label).toBeGreaterThanOrEqual(-0.5);
      expect(item.right, item.label).toBeLessThanOrEqual(width + 0.5);
      expect(item.bottom, item.label).toBeLessThanOrEqual(heightFor(width) + 0.5);
      expect(item.height, `${item.label} is a 44px target`).toBeGreaterThanOrEqual(44);
      expect(item.hit, `${item.label} is what a tap at its centre reaches`).toBe(true);
      expect(item.clipped, `${item.label} is not cut off`).toBeLessThanOrEqual(0);
      // From 180px a one-word label is never broken inside the word; "Sign out" may take two lines. Below 180px (a 40px
      // column) "Staples" and "Settings" cannot fit on one line, so they may break (design rules on this, see the PR).
      expect(item.lines, `${item.label} lines`).toBeLessThanOrEqual(
        item.label.endsWith("Sign out") || width < 180 ? 2 : 1,
      );
    }
    expect(facts.map((item) => item.label).join("|")).toContain("Sign out");
    // The top bar: every control inside the viewport.
    const top = await page.locator(".topbar a, .topbar button").evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            label: node.getAttribute("aria-label") ?? node.textContent,
            left: rect.left,
            right: rect.right,
          };
        }),
    );
    expect(top.length).toBeGreaterThan(0);
    for (const control of top) {
      expect(control.left, String(control.label)).toBeGreaterThanOrEqual(-0.5);
      expect(control.right, String(control.label)).toBeLessThanOrEqual(width + 0.5);
    }
    // The wordmark is hidden only below 180px, and its accessible name stays.
    await expect(page.getByRole("link", { name: "Packed Smart: go to trips" })).toBeVisible();
    await expectAccessible(page, `bars at ${width}px`);
  });
}

for (const width of NARROW) {
  test(`the failed-save states fit at ${width}px`, tagFor(width), async ({ page }) => {
    test.setTimeout(120_000);
    await openDashboard(page, width);
    await page.route("**/*", (route) =>
      route.request().method() === "POST" && new URL(route.request().url()).pathname === "/"
        ? route.abort("failed")
        : route.continue(),
    );
    await chooseFromMenu(page, "San Diego", "Archive");
    const chip = page.getByRole("button", { name: "Not saved, retry" });
    await expect(chip).toBeVisible();
    await expectFits(page, `Not saved chip at ${width}px`, `${width}-chip-not-saved`);
    await chip.click();
    await expect(page.getByRole("dialog", { name: "Couldn’t save" })).toBeVisible();
    await expectFits(page, `Couldn’t save sheet at ${width}px`, `${width}-chip-sheet`);
    await page
      .getByRole("dialog", { name: "Couldn’t save" })
      .getByRole("button", { name: "Dismiss" })
      .click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Settings" })
      .click();
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    const box = (await retry.boundingBox())!;
    expect(box.x, "Retry starts inside the viewport").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "Retry ends inside the viewport").toBeLessThanOrEqual(width + 0.5);
    await expectFits(page, `Settings failed state at ${width}px`, `${width}-settings-failed`);
  });
}

// ---- 320, 390 and 1280 are unchanged: the key rects equal what develop drew before this change (captured from it) ----
const PINNED = ["/", "/settings", "/staples", "/trips/new", "/staples/lists"] as const;
const KEY_SELECTORS = [
  ".topbar",
  ".bottom-nav",
  ".bottom-nav > :nth-child(4)",
  "h1",
  ".page-head",
  ".trip-card",
  ".ledger-hero",
  ".card",
  ".status-pill",
  ".staple-category",
  ".list-item-row",
  ".saved-list-card",
  ".theme-options",
  ".two-col",
  ".brand-button",
] as const;

async function keyRects(page: Page) {
  return page.evaluate((selectors) => {
    const out: Record<string, number[]> = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      out[selector] = [rect.x, rect.y + scrollY, rect.width, rect.height].map(Math.round);
    }
    return out;
  }, KEY_SELECTORS);
}

for (const width of [320, 390, 1280] as const) {
  test(`key layout is unchanged at ${width}px`, {}, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDashboard(page, width);
    await seedSavedList(ownerId(), "Beach week", [
      { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    ]);
    const seen: Record<string, Record<string, number[]>> = {};
    for (const path of PINNED) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      // The page is fully drawn: the dashboard's hero, a list's cards, the Staples categories.
      if (path === "/") await expect(page.locator(".ledger-hero")).toBeVisible();
      if (path === "/staples") await expect(page.locator(".staple-category").first()).toBeVisible();
      if (path === "/staples/lists")
        await expect(page.locator(".saved-list-card").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle");
      seen[path] = await keyRects(page);
    }
    if (process.env.CAPTURE_RECTS) {
      appendFileSync(process.env.CAPTURE_RECTS, `${JSON.stringify({ width, seen })}\n`);
      return;
    }
    expect(seen).toEqual(BASELINE[width]);
  });
}

const BASELINE: Record<number, Record<string, Record<string, number[]>>> = {
  "320": {
    "/": {
      ".topbar": [0, 0, 320, 52],
      ".bottom-nav": [0, 373, 320, 49],
      ".bottom-nav > :nth-child(4)": [240, 374, 80, 48],
      h1: [18, 98, 284, 82],
      ".ledger-hero": [16, 316, 288, 565],
      ".brand-button": [10, 4, 161, 44],
    },
    "/settings": {
      ".topbar": [0, 0, 320, 52],
      ".bottom-nav": [0, 373, 320, 49],
      ".bottom-nav > :nth-child(4)": [240, 374, 80, 48],
      h1: [18, 84, 284, 29],
      ".page-head": [18, 66, 284, 79],
      ".card": [16, 165, 288, 593],
      ".theme-options": [37, 309, 246, 388],
      ".brand-button": [10, 4, 161, 44],
    },
    "/staples": {
      ".topbar": [0, 0, 320, 52],
      ".bottom-nav": [0, 373, 320, 49],
      ".bottom-nav > :nth-child(4)": [240, 374, 80, 48],
      h1: [16, 84, 288, 29],
      ".page-head": [16, 66, 288, 207],
      ".staple-category": [16, 482, 288, 282],
      ".brand-button": [10, 4, 161, 44],
    },
    "/trips/new": {
      ".topbar": [0, 0, 320, 52],
      ".bottom-nav": [0, 373, 320, 49],
      ".bottom-nav > :nth-child(4)": [240, 374, 80, 48],
      h1: [74, 84, 228, 29],
      ".page-head": [18, 66, 284, 127],
      ".card": [16, 213, 288, 587],
      ".two-col": [37, 354, 246, 144],
      ".brand-button": [10, 4, 161, 44],
    },
    "/staples/lists": {
      ".topbar": [0, 0, 320, 52],
      ".bottom-nav": [0, 373, 320, 49],
      ".bottom-nav > :nth-child(4)": [240, 374, 80, 48],
      h1: [16, 84, 288, 29],
      ".page-head": [16, 66, 288, 103],
      ".saved-list-card": [16, 249, 288, 160],
      ".brand-button": [10, 4, 161, 44],
    },
  },
  "390": {
    "/": {
      ".topbar": [0, 0, 390, 52],
      ".bottom-nav": [0, 373, 390, 49],
      ".bottom-nav > :nth-child(4)": [293, 374, 98, 48],
      h1: [18, 98, 316, 41],
      ".ledger-hero": [16, 275, 358, 565],
      ".brand-button": [16, 4, 198, 44],
    },
    "/settings": {
      ".topbar": [0, 0, 390, 52],
      ".bottom-nav": [0, 373, 390, 49],
      ".bottom-nav > :nth-child(4)": [293, 374, 98, 48],
      h1: [18, 84, 354, 29],
      ".page-head": [18, 66, 354, 79],
      ".card": [16, 165, 358, 593],
      ".theme-options": [37, 309, 316, 388],
      ".brand-button": [16, 4, 198, 44],
    },
    "/staples": {
      ".topbar": [0, 0, 390, 52],
      ".bottom-nav": [0, 373, 390, 49],
      ".bottom-nav > :nth-child(4)": [293, 374, 98, 48],
      h1: [16, 84, 358, 29],
      ".page-head": [16, 66, 358, 183],
      ".staple-category": [16, 440, 358, 282],
      ".brand-button": [16, 4, 198, 44],
    },
    "/trips/new": {
      ".topbar": [0, 0, 390, 52],
      ".bottom-nav": [0, 373, 390, 49],
      ".bottom-nav > :nth-child(4)": [293, 374, 98, 48],
      h1: [74, 84, 298, 29],
      ".page-head": [18, 66, 354, 103],
      ".card": [16, 189, 358, 569],
      ".two-col": [37, 330, 316, 144],
      ".brand-button": [16, 4, 198, 44],
    },
    "/staples/lists": {
      ".topbar": [0, 0, 390, 52],
      ".bottom-nav": [0, 373, 390, 49],
      ".bottom-nav > :nth-child(4)": [293, 374, 98, 48],
      h1: [16, 84, 358, 29],
      ".page-head": [16, 66, 358, 103],
      ".saved-list-card": [16, 249, 358, 160],
      ".brand-button": [16, 4, 198, 44],
    },
  },
  "1280": {
    "/": {
      ".topbar": [0, 0, 1280, 68],
      ".bottom-nav": [0, 0, 0, 0],
      ".bottom-nav > :nth-child(4)": [1159, 12, 91, 44],
      h1: [30, 122, 506, 65],
      ".ledger-hero": [28, 263, 900, 313],
      ".brand-button": [30, 12, 198, 44],
    },
    "/settings": {
      ".topbar": [0, 0, 1280, 68],
      ".bottom-nav": [0, 0, 0, 0],
      ".bottom-nav > :nth-child(4)": [1159, 12, 91, 44],
      h1: [260, 108, 760, 47],
      ".page-head": [260, 90, 760, 97],
      ".card": [260, 207, 760, 369],
      ".theme-options": [281, 327, 718, 188],
      ".brand-button": [30, 12, 198, 44],
    },
    "/staples": {
      ".topbar": [0, 0, 1280, 68],
      ".bottom-nav": [0, 0, 0, 0],
      ".bottom-nav > :nth-child(4)": [1159, 12, 91, 44],
      h1: [260, 108, 683, 47],
      ".page-head": [260, 90, 760, 121],
      ".staple-category": [260, 376, 760, 283],
      ".brand-button": [30, 12, 198, 44],
    },
    "/trips/new": {
      ".topbar": [0, 0, 1280, 68],
      ".bottom-nav": [0, 0, 0, 0],
      ".bottom-nav > :nth-child(4)": [1159, 12, 91, 44],
      h1: [86, 108, 1164, 47],
      ".page-head": [30, 90, 1220, 97],
      ".card": [28, 207, 1224, 463],
      ".two-col": [49, 334, 1182, 66],
      ".brand-button": [30, 12, 198, 44],
    },
    "/staples/lists": {
      ".topbar": [0, 0, 1280, 68],
      ".bottom-nav": [0, 0, 0, 0],
      ".bottom-nav > :nth-child(4)": [1159, 12, 91, 44],
      h1: [260, 108, 760, 47],
      ".page-head": [260, 90, 760, 97],
      ".saved-list-card": [260, 267, 760, 157],
      ".brand-button": [30, 12, 198, 44],
    },
  },
};
