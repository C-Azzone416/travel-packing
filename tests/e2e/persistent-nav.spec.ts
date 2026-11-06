import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import { connectedOnTrips, fakeFramebriar, forgetFeedbackEnrollment } from "./helpers/feedback";
import { serverActionId } from "./helpers/server-action";
import { chooseFromMenu } from "./helpers/menu";

// Persistent navigation and Feedback on long pages (#282). Every assertion compares against real neighbours (the bar's
// rect, the tab bar's rect, what is actually under a point), because a check that only says "is in the viewport" passed
// while content was hidden (#288). E2E_MUTANT_CSS lets a reviewer inject CSS after load to prove an assertion can fail
// (for example `.topbar{position:static}`); it is unset in CI and in normal runs.
const MUTANT_CSS = process.env.E2E_MUTANT_CSS;
// San Diego is upcoming on the dashboard only with a fixed clock (as in trip-screen.spec.ts).
const DASHBOARD_NOW = new Date("2026-10-16T12:00:00");

// Playwright's locator.click() scrolls a sticky element to its in-flow position first (the page jumped 322px before the
// click even landed), which would hide the very thing under test. A real pointer press at the control's centre is what a
// person does, so scroll position is only ever moved by the app.
async function pressWithMouse(page: Page, control: Locator) {
  const box = (await control.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const SCREENS = [
  { name: "Staples", path: "/staples", ready: "Staples" },
  { name: "Settings", path: "/settings", ready: "Settings" },
] as const;

/** Wide sizes run on desktop only; phone sizes carry @device so the iPhone profile runs them as well. */
const WIDE = [
  { width: 1280, height: 700 },
  { width: 1024, height: 700 },
] as const;
/** Everything below 1024 is the phone layout (#383): the floating tab bar, also at tablet widths. */
const PHONE = [
  { width: 390, height: 700 },
  { width: 320, height: 640 },
  { width: 721, height: 700 },
] as const;

async function openScreen(
  page: Page,
  screen: (typeof SCREENS)[number],
  requested: { width: number; height: number },
) {
  // The redesigned Staples page packs its cubes into two columns on a laptop, so it is shorter than the old list; a lower
  // window keeps the fixture long enough to scroll (the check below still proves it).
  const size =
    screen.name === "Staples" && requested.width >= 1024
      ? { width: requested.width, height: Math.min(requested.height, 560) }
      : requested;
  await page.setViewportSize(size);
  await signInAsOwner(page);
  await page.goto(screen.path);
  await expect(page.getByRole("heading", { name: screen.ready, level: 1 })).toBeVisible();
  if (screen.name === "Staples")
    await expect(page.locator("[data-staple-id]").first()).toBeVisible();
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
  // The fixture must really be long: a short page would pass every "while scrolled" assertion vacuously.
  const [height, inner] = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    innerHeight,
  ]);
  expect(height).toBeGreaterThan(inner + 400);
}

const scrollToBottom = (page: Page) =>
  page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
const scrollToTop = (page: Page) => page.evaluate(() => scrollTo(0, 0));

/** The vertical band content may occupy: below the sticky bar, above the phone tab bar. */
function limits(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".topbar")!;
    const nav = document.querySelector(".bottom-nav")!;
    const sticky = getComputedStyle(bar).position === "sticky";
    const fixedNav = getComputedStyle(nav).display !== "contents";
    return {
      top: sticky ? bar.getBoundingClientRect().bottom : 0,
      bottom: fixedNav ? nav.getBoundingClientRect().top : innerHeight,
      fixedNav,
      innerHeight,
    };
  });
}

/** What is actually painted at the centre of each persistent control, and whether it is the control (or inside it). */
function coverage(page: Page) {
  return page.evaluate(() => {
    const controls: Record<string, Element | null> = {
      brand: document.querySelector(".shell-brand"),
      trips:
        [...document.querySelectorAll(".bottom-nav a")].find((a) =>
          a.textContent?.includes("Trips"),
        ) ?? null,
      staples:
        [...document.querySelectorAll(".bottom-nav a")].find((a) =>
          a.textContent?.includes("Staples"),
        ) ?? null,
      settings:
        [...document.querySelectorAll(".bottom-nav a")].find((a) =>
          a.textContent?.includes("Settings"),
        ) ?? null,
      signOut: document.querySelector(".nav-signout button"),
      feedback: document.querySelector(".nav-feedback"),
    };
    return Object.entries(controls).map(([name, element]) => {
      if (!element) return { name, present: false, top: 0, onTop: false, inViewport: false };
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        name,
        present: true,
        top: rect.top,
        onTop: !!hit && (hit === element || element.contains(hit)),
        inViewport:
          rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
      };
    });
  });
}

/** The lowest bottom edge among the page's in-flow content (fixed and sticky parts are chrome, not content). */
const contentBottom = (page: Page) =>
  page.evaluate(() => {
    let bottom = 0;
    for (const element of document.querySelectorAll("main *")) {
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.position === "sticky") continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      bottom = Math.max(bottom, rect.bottom);
    }
    return bottom;
  });

for (const size of [...WIDE, ...PHONE]) {
  const tag = size.width >= 1024 ? {} : DEVICE;
  for (const screen of SCREENS) {
    test(
      `${screen.name} at ${size.width}px: bar and Feedback stay on top, last content stays clear (#282)`,
      tag,
      async ({ page }) => {
        await openScreen(page, screen, size);
        await scrollToBottom(page);
        const { fixedNav } = await limits(page);
        expect(fixedNav).toBe(size.width < 1024);

        // 1. The bar is pinned at the top of the viewport and nothing covers any persistent control.
        expect((await page.locator(".topbar").boundingBox())!.y).toBe(0);
        for (const control of await coverage(page)) {
          // On a phone the 4th slot is Feedback and Sign out is a Settings row (#293); the header holds both from 1024px.
          if (fixedNav && control.name === "signOut") continue;
          expect(control.present, `${control.name} present`).toBe(true);
          expect(control.inViewport, `${control.name} inside the viewport`).toBe(true);
          expect(control.onTop, `${control.name} is not covered`).toBe(true);
        }
        // The tab bar floats 8px above the bottom edge on phones.
        if (fixedNav) {
          const nav = (await page.locator(".bottom-nav").boundingBox())!;
          expect(Math.round(nav.y + nav.height)).toBe(size.height - 8);
        }

        // 2. The last content is clear of the tab bar (phones) or the page edge, with at least 16px.
        const band = await limits(page);
        expect(await contentBottom(page)).toBeLessThanOrEqual(band.bottom - 16);

        // 7. No horizontal overflow.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);

        if (size.width === 1280 || size.width === 390) {
          // #377: the redesign palette puts the "Add" label on the terracotta button below 4.5:1; contrast is tracked there.
          await expectAccessible(
            page,
            `${screen.name} ${size.width} scrolled to the bottom`,
            screen.name === "Staples" ? { disable: ["color-contrast"] } : {},
          );
        }
      },
    );
  }
}

test("Staples and Settings at 981px and 667x375 have no horizontal overflow", async ({ page }) => {
  await signInAsOwner(page);
  for (const size of [
    { width: 981, height: 700 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { name: screen.ready, level: 1 })).toBeVisible();
      for (const where of [scrollToTop, scrollToBottom]) {
        await where(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} ${size.width}x${size.height}`).toBe(0);
      }
    }
  }
});

test(
  "a --safe-bottom override grows the tab bar and the page keeps clear of it (#282)",
  DEVICE,
  async ({ page }) => {
    await openScreen(page, SCREENS[0], PHONE[0]);
    await page.addStyleTag({ content: ":root{--safe-bottom:34px}" });
    await scrollToBottom(page);
    const nav = (await page.locator(".bottom-nav").boundingBox())!;
    expect(Math.round(nav.height)).toBe(60); // the 48px tabs inside 6px of padding; the bar floats 8px + the inset above the edge
    const band = await limits(page);
    expect(Math.round(band.bottom)).toBe(PHONE[0].height - 34 - 8 - 60);
    expect(await contentBottom(page)).toBeLessThanOrEqual(band.bottom - 16);
    // The sticky Staples actions and toasts follow the same token, not a literal.
    const offsets = await page.evaluate(() => ({
      padding: parseFloat(getComputedStyle(document.querySelector(".app-shell")!).paddingBottom),
      scrollPadding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
    }));
    expect(offsets.padding).toBe(60 + 8 + 34 + 16);
    expect(offsets.scrollPadding).toBe(60 + 8 + 34 + 12);
  },
);

for (const viewport of [WIDE[0], PHONE[0]]) {
  const tag = viewport.width >= 1024 ? {} : DEVICE;
  test(
    `keyboard focus lands clear of both bars at ${viewport.width}px (#282)`,
    {}, // desktop browser only: the iPhone profile has no physical keyboard, and WebKit's Tab order skips buttons
    async ({ page }) => {
      await openScreen(page, SCREENS[0], viewport);
      const inMain = () =>
        page.evaluate(() => {
          const element = document.activeElement;
          if (!element || !element.closest("main")) return null;
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });

      // Forward from the top: each stop is below the bar and above the tab bar.
      await scrollToTop(page);
      const band = await limits(page);
      await page.locator("main").focus();
      let stops = 0;
      let seenMain = false;
      let furthest = 0; // 80 Tabs can wrap past the last stop back to the top, so the furthest scroll is the fact, not the last
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press("Tab");
        furthest = Math.max(furthest, await page.evaluate(() => scrollY));
        const at = await inMain();
        if (!at) {
          // Tab has left the last stop of a short page (focus went to the browser); another press would wrap to the top.
          if (seenMain) break;
          continue;
        }
        seenMain = true;
        stops += 1;
        expect(at.top).toBeGreaterThanOrEqual(band.top - 0.5);
        expect(at.bottom).toBeLessThanOrEqual(band.bottom + 0.5);
      }
      expect(stops).toBeGreaterThan(5); // WebKit's native Tab order skips some buttons
      // On Staples the last stops are the sticky Preview panel, which is always on screen, so the final scroll may be back up.
      expect(furthest).toBeGreaterThan(150);

      // Backward from the bottom: elements above the viewport are scrolled in from the top edge, the case scroll-padding fixes.
      await scrollToBottom(page);
      await page.evaluate(() => {
        const all = [
          ...document.querySelectorAll<HTMLElement>("main a, main button, main input, main select"),
          // A sticky side panel (the Staples preview) is always on screen, so it cannot be the far end of the page.
        ].filter(
          (element) => element.getBoundingClientRect().height > 0 && !element.closest("aside"),
        );
        all.at(-1)!.focus();
      });
      const start = await page.evaluate(() => scrollY);
      let backStops = 0;
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press("Shift+Tab");
        const at = await inMain();
        if (!at) break;
        backStops += 1;
        expect(at.top).toBeGreaterThanOrEqual(band.top - 0.5);
        expect(at.bottom).toBeLessThanOrEqual(band.bottom + 0.5);
      }
      expect(backStops).toBeGreaterThan(8);
      expect(await page.evaluate(() => scrollY)).toBeLessThan(start - 300);
    },
  );

  test(
    `anchor and scrollIntoView targets land below the bar at ${viewport.width}px (#282)`,
    tag,
    async ({ page }) => {
      await page.clock.setFixedTime(DASHBOARD_NOW);
      await openScreen(page, SCREENS[0], viewport);
      await scrollToTop(page);
      // The second target, not the last: the last one sits at the end of the page, where scrolling clamps and proves nothing.
      const landed = async (selector: string) => {
        await page.evaluate((s) => {
          const all = document.querySelectorAll(s);
          if (all.length < 2) throw new Error(`need two ${s}`);
          all[1].scrollIntoView();
        }, selector);
        return page.evaluate((s) => {
          const rect = document.querySelectorAll(s)[1].getBoundingClientRect();
          return {
            top: rect.top,
            barBottom: document.querySelector(".topbar")!.getBoundingClientRect().bottom,
          };
        }, selector);
      };
      const heading = await landed("main h2");
      expect(heading.top).toBeGreaterThanOrEqual(heading.barBottom);

      // A packing-list section reached through the sections panel, as a real anchor click. That panel belongs to the page
      // below 1024px (the laptop view has no sections panel, #385), so a laptop width checks it just under the breakpoint.
      if (viewport.width >= 1024) await legacyPackingLayout(page);
      await page.goto("/");
      await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
      await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
      if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
      const section = await landed(".list-section");
      expect(section.top).toBeGreaterThanOrEqual(section.barBottom);
      const link = page.locator(".sections-panel a").nth(1);
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const target = await page.evaluate(() => {
        const rect = document.querySelector(":target")!.getBoundingClientRect();
        return {
          top: rect.top,
          barBottom: document.querySelector(".topbar")!.getBoundingClientRect().bottom,
        };
      });
      expect(target.top).toBeGreaterThanOrEqual(target.barBottom);
    },
  );
}

test(
  "Feedback opens and closes without moving the page, and focus comes back (#282)",
  DEVICE,
  async ({ page }) => {
    await fakeFramebriar.reset();
    await connectedOnTrips(page);
    await page.setViewportSize(PHONE[0]);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Staples" })
      .click();
    await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
    await expect(page.locator("[data-staple-id]").first()).toBeVisible();
    if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
    await scrollToBottom(page);
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(300);

    const feedback = page.getByRole("button", { name: "Send feedback" });
    await expect(feedback).toBeEnabled();
    expect((await feedback.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await pressWithMouse(page, feedback);
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(before);

    // 10. Layering: the sheet and its backdrop cover the bars, and Tab never reaches them.
    const covered = await page.evaluate(() => {
      const probe = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2);
        return !!hit?.closest(".modal-backdrop, [role=dialog]");
      };
      return { bar: probe(".topbar"), tabs: probe(".bottom-nav") };
    });
    expect(covered).toEqual({ bar: true, tabs: true });
    // The background is inert while the sheet is open, so a hit test alone would not notice a bar painted over the dimmed page:
    // the stacking order must also put the sheet above both bars (bar 40, tab bar 20, sheet 50).
    const z = await page.evaluate(() => {
      const of = (selector: string) =>
        Number(getComputedStyle(document.querySelector(selector)!).zIndex);
      return {
        tabs: of(".bottom-nav"),
        bar: of(".topbar"),
        sheet: of(".modal-backdrop"),
        toast: of(".toast-region"),
        error: of(".error-region"),
        skip: of(".skip-link"),
      };
    });
    expect(z.tabs).toBeLessThan(z.bar);
    expect(z.bar).toBeLessThan(z.sheet);
    expect(z.sheet).toBeLessThan(z.toast);
    expect(z.toast).toBeLessThan(z.error);
    expect(z.error).toBeLessThan(z.skip);
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      const inChrome = await page.evaluate(
        () => !!document.activeElement?.closest(".topbar, .bottom-nav"),
      );
      expect(inChrome).toBe(false);
    }

    await pressWithMouse(page, dialog.getByRole("button", { name: "Cancel" }));
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await expect(feedback).toBeFocused();
  },
);

test(
  "Feedback is disabled and untabbable until connected, and absent on sign-in (#282)",
  DEVICE,
  async ({ page }, testInfo) => {
    await fakeFramebriar.reset();
    await signInAsOwner(page);
    await forgetFeedbackEnrollment(`e2e-${ownerEmailFor(testInfo.project.name)}`);
    await page.setViewportSize(PHONE[0]);
    await page.goto("/staples");
    await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
    await expect(page.locator("[data-staple-id]").first()).toBeVisible();
    await scrollToBottom(page);
    const feedback = page.getByRole("button", { name: "Send feedback" });
    await expect(feedback).toBeDisabled();
    // Still pinned and visible, so it is not mistaken for missing.
    expect((await feedback.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      await expect(feedback).not.toBeFocused();
    }
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  },
);

test(
  "the wordmark stays on one line beside the save chip at 320px (#282)",
  DEVICE,
  async ({ page }) => {
    await fakeFramebriar.reset();
    await page.clock.setFixedTime(DASHBOARD_NOW);
    await signInAsOwner(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
    const feedback = page.getByRole("button", { name: "Send feedback" });
    const feedbackX = Math.round((await feedback.boundingBox())!.x);

    const archiveAction = serverActionId("src/features/trips/actions.ts", "archiveTripAction");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().headers()["next-action"] === archiveAction) await held;
      await route.continue();
    });
    const archive = chooseFromMenu(page, "San Diego", "Archive");
    const chip = page.getByRole("link", { name: /Saving|Saved|Not saved/ });
    await expect(chip).toBeVisible();

    const check = async () => {
      const result = await page.evaluate(() => {
        const word = document.querySelector(".shell-brand strong")!;
        const style = getComputedStyle(word);
        const chipRect = document.querySelector(".sync-chip")!.getBoundingClientRect();
        const brand = document.querySelector(".shell-brand")!;
        return {
          height: word.getBoundingClientRect().height,
          lineHeight: parseFloat(style.fontSize) * 1.6,
          wordOverflow: brand.scrollWidth - brand.clientWidth,
          chipWidth: chipRect.width,
          chipRight: chipRect.right,
          innerWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(result.height).toBeLessThan(result.lineHeight);
      // The wordmark is not squeezed: its box fits inside the brand link, so Feedback is never pushed by a shrinking brand.
      expect(result.wordOverflow).toBeLessThanOrEqual(0);
      expect(result.chipWidth).toBeGreaterThanOrEqual(44);
      expect(result.chipRight).toBeLessThanOrEqual(result.innerWidth - 8);
      expect(result.overflow).toBe(0);
      expect(Math.round((await feedback.boundingBox())!.x)).toBe(feedbackX);
    };
    await check();
    release();
    await archive;
    await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
    await check();
  },
);

/**
 * Everything wrong with the inline bar right now: a brand link that cannot hold its wordmark, two persistent controls drawn over
 * each other, a label broken over two lines, a control outside the viewport. Empty means the bar fits. (A row-height check
 * missed a two-line "Sign out", so lines are counted on the text itself.)
 */
function barProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const brand = document.querySelector<HTMLElement>(".shell-brand")!;
    if (brand.scrollWidth > brand.clientWidth) {
      problems.push(`brand overflows its box by ${brand.scrollWidth - brand.clientWidth}px`);
    }
    const controls: [string, Element | null][] = [
      ["brand", brand],
      ...[...document.querySelectorAll(".bottom-nav a")].map((e): [string, Element] => [
        `link ${e.textContent}`,
        e,
      ]),
      ["sign out", document.querySelector(".nav-signout button")],
      ["feedback", document.querySelector(".nav-feedback")],
      ["chip", document.querySelector(".sync-chip")],
    ];
    const boxes: [string, DOMRect][] = [];
    for (const [name, element] of controls) {
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0) continue;
      boxes.push([name, rect]);
      if (rect.left < 0 || rect.right > innerWidth) problems.push(`${name} leaves the viewport`);
      // Lines of text: every visible text node must sit on one line.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set(
          [...range.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top)),
        );
        if (tops.size > 1) problems.push(`${name} wraps onto ${tops.size} lines`);
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [a, x] = boxes[i];
        const [b, y] = boxes[j];
        const overlap = Math.min(x.right, y.right) - Math.max(x.left, y.left);
        const stack = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
        if (overlap > 0.5 && stack > 0.5) problems.push(`${a} overlaps ${b}`);
      }
    }
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) problems.push(`page overflows by ${overflow}px`);
    return problems;
  });
}

const INLINE_SIZES = [
  { width: 1280, height: 700 },
  { width: 1024, height: 700 },
] as const;

for (const size of INLINE_SIZES) {
  for (const state of ["Saving", "Saved", "Not saved"] as const) {
    test(`the top menu fits with the "${state}" chip at ${size.width}x${size.height} (#282)`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(DASHBOARD_NOW);
      await signInAsOwner(page);
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
      if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
      expect(await barProblems(page)).toEqual([]); // no chip yet

      const archiveAction = serverActionId("src/features/trips/actions.ts", "archiveTripAction");
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/*", async (route) => {
        const isArchive = route.request().headers()["next-action"] === archiveAction;
        if (!isArchive) return route.continue();
        if (state === "Not saved") return route.abort("failed");
        if (state === "Saving") await held;
        return route.continue();
      });
      const archive = chooseFromMenu(page, "San Diego", "Archive");
      const chip =
        state === "Not saved"
          ? page.getByRole("button", { name: "Not saved, retry" })
          : page.getByRole("link", { name: state });
      await expect(chip).toBeVisible();
      expect(await barProblems(page)).toEqual([]);
      release();
      await archive;
    });
  }
}

const SHORT = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
  { width: 320, height: 256 },
] as const;

test("short viewports keep the persistent chrome small or let the bar scroll away (#282)", async ({
  page,
}) => {
  await signInAsOwner(page);
  for (const size of SHORT) {
    await page.setViewportSize(size);
    await page.goto("/staples");
    await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
    if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
    for (const where of [scrollToTop, scrollToBottom]) {
      await where(page);
      const facts = await page.evaluate(() => {
        const bar = document.querySelector(".topbar")!;
        const nav = document.querySelector(".bottom-nav")!;
        const barRect = bar.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const inline = getComputedStyle(nav).display === "contents";
        // Only the drawn controls: the wide-screen Sign out is display:none on a phone (#293).
        const links = [...document.querySelectorAll(".bottom-nav a, .bottom-nav button")]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0);
        return {
          barHeight: barRect.height,
          position: getComputedStyle(bar).position,
          inline,
          navTop: navRect.top,
          navBottom: navRect.bottom,
          innerHeight,
          innerWidth,
          linkHeights: links.map((r) => r.height),
          linksInView: links.every((r) => r.bottom <= innerHeight && r.top >= 0),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      const label = `${size.width}x${size.height}`;
      expect(facts.overflow, label).toBe(0);
      // Every one of these is below 1024 wide, so all are the phone layout (#383): the floating tab bar, never inline.
      expect(facts.inline, label).toBe(false);
      expect(Math.round(facts.navBottom), label).toBe(facts.innerHeight - 8);
      expect(Math.min(...facts.linkHeights), label).toBeGreaterThanOrEqual(44);
      expect(facts.linksInView, label).toBe(true);
      // The short variant keeps 44px targets: a 56px bar, not the 60px one.
      expect(Math.round(facts.navBottom - facts.navTop), label).toBe(56);
      // Under 400px tall two bars would cost too much of the screen, so the header scrolls away (the tab bar stays).
      expect(facts.position === "static", label).toBe(size.height <= 400);
    }
  }
});

test("the current page is a dark pill, the header is 84px (laptop) or 56px (phone), and Sign out works from the sticky bar (#383)", async ({
  page,
}) => {
  await signInAsOwner(page);
  // The phone size first: Sign out is visible on the laptop only when Feedback is on, so it is clicked at the end, on the laptop.
  for (const size of [
    { width: 844, height: 390 },
    { width: 1280, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/staples");
    await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
    if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
    await scrollToBottom(page);
    const facts = await page.evaluate(() => {
      const link = document.querySelector<HTMLElement>('.bottom-nav a[aria-current="page"]')!;
      return {
        text: link.textContent,
        current: document.querySelectorAll('.bottom-nav a[aria-current="page"]').length,
        background: getComputedStyle(link).backgroundColor,
        barHeight: document.querySelector(".topbar")!.getBoundingClientRect().height,
      };
    });
    expect(facts.text).toContain("Staples");
    expect(facts.current).toBe(1);
    expect(facts.background).toBe("rgb(20, 43, 59)");
    expect(facts.barHeight).toBe(size.width >= 1024 ? 84 : 56);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the bar and its ancestors keep sticky working, and the bar does not animate (#282)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await page.goto("/staples");
  await expect(page.getByRole("heading", { name: "Staples", level: 1 })).toBeVisible();
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
  const bad = await page.evaluate(() => {
    const problems: string[] = [];
    for (
      let node: Element | null = document.querySelector(".topbar");
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      const label =
        node.tagName.toLowerCase() +
        (node.className ? `.${String(node.className).split(" ")[0]}` : "");
      if (style.transform !== "none") problems.push(`${label} transform`);
      if (style.filter !== "none") problems.push(`${label} filter`);
      if (style.backdropFilter !== "none" && style.backdropFilter !== "")
        problems.push(`${label} backdrop-filter`);
      if (style.willChange !== "auto") problems.push(`${label} will-change`);
      if (node.tagName !== "HTML" && node.tagName !== "BODY" && style.overflow !== "visible")
        problems.push(`${label} overflow ${style.overflow}`);
      if (node.tagName === "HTML" || node.tagName === "BODY") {
        if (style.overflowX === "hidden" || style.overflowY === "hidden")
          problems.push(`${label} overflow hidden`);
      }
      if (style.contain !== "none") problems.push(`${label} contain`);
    }
    const bar = getComputedStyle(document.querySelector(".topbar")!);
    return { problems, duration: bar.transitionDuration, animation: bar.animationName };
  });
  expect(bad.problems).toEqual([]);
  expect(parseFloat(bad.duration)).toBeLessThanOrEqual(0.001); // reduced motion: effectively none
  expect(bad.animation).toBe("none");
});
