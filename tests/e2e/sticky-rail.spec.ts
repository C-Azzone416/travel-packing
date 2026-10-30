import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// The trip screen's right rail (#297): at 900px and wider the whole rail (sections nav, Ready card, Trip math) is ONE sticky
// unit, so the sections links can never cover Trip math. Every assertion compares real rects; the fixture must really be long.
// E2E_MUTANT_CSS injects CSS after load so a reviewer can prove each assertion can fail.
const MUTANT_CSS = process.env.E2E_MUTANT_CSS;

async function openTrip(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
  await signInAsOwner(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  await expect(page.locator(".trip-layout .side .sections-panel")).toBeVisible();
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
  const [height, inner] = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    innerHeight,
  ]);
  // Not vacuous: the page scrolls well past one viewport.
  expect(height).toBeGreaterThan(inner + 400);
}

/** Every geometry fact the spec asks for, measured at the current scroll position. */
function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const bar = document.querySelector(".topbar")!.getBoundingClientRect();
    const rail = document.querySelector(".trip-layout .side")!;
    const railRect = rail.getBoundingClientRect();
    const nav = rect(rail.querySelector(".sections-panel"))!;
    const cards = [...rail.children].filter((c) => !c.classList.contains("sections-panel"));
    const math = rect(
      rail.querySelector("[data-trip-math], .trip-math") ?? cards[cards.length - 1],
    );
    const list = document.querySelector(".trip-layout > :not(.side)")!.getBoundingClientRect();
    const links = [...rail.querySelectorAll(".sections-panel a")].map((a) => {
      const r = a.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = Math.min(Math.max(r.top + r.height / 2, bar.bottom + 1), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      const visible = r.bottom > bar.bottom && r.top < innerHeight;
      return { covered: visible && !(hit === a || a.contains(hit)) };
    });
    const topHit = document.elementFromPoint(railRect.left + 2, bar.bottom + 2);
    return {
      railPos: getComputedStyle(rail).position,
      navPos: getComputedStyle(rail.querySelector(".sections-panel")!).position,
      barBottom: bar.bottom,
      railTop: railRect.top,
      railBottom: railRect.bottom,
      navBottom: nav.bottom,
      mathTop: math ? math.top : null,
      mathBottom: math ? math.bottom : null,
      railLeft: railRect.left,
      listRight: list.right,
      innerHeight,
      coveredLinks: links.filter((l) => l.covered).length,
      scrollY,
      pageHeight: document.documentElement.scrollHeight,
      topHitInRail: topHit ? rail.contains(topHit) || topHit.closest(".topbar") !== null : false,
    };
  });
}

const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 700 },
] as const;

for (const size of WIDTHS) {
  test(`the trip rail is one sticky unit and never overlaps at ${size.width}x${size.height} (#297)`, async ({
    page,
  }) => {
    await openTrip(page, size);
    const first = await measure(page);
    expect(first.railPos).toBe("sticky");
    expect(first.navPos).toBe("static");

    const total = first.pageHeight - size.height;
    let stuckStops = 0;
    for (let y = 0; y <= total; y += 150) {
      await page.evaluate((to) => scrollTo(0, to), y);
      const m = await measure(page);
      // The nav sits above Trip math, with no overlap, at every stop.
      expect(m.mathTop, `math top at ${y}`).not.toBeNull();
      expect(m.navBottom, `nav above math at ${y}`).toBeLessThanOrEqual(m.mathTop! + 0.5);
      // Stuck stops (clear of both ends of the list): the whole rail sits just under the bar and inside the viewport.
      if (y >= first.railTop && y <= total - 600) {
        expect(m.railTop, `rail below bar at ${y}`).toBeGreaterThanOrEqual(m.barBottom + 12 - 5);
        expect(m.railTop, `rail stuck at ${y}`).toBeLessThanOrEqual(m.barBottom + 12 + 4);
        expect(m.railBottom, `rail bottom at ${y}`).toBeLessThanOrEqual(m.innerHeight - 12 + 5);
        stuckStops++;
      }
      expect(m.railLeft, `rail beside the list at ${y}`).toBeGreaterThanOrEqual(
        m.listRight + 24 - 1,
      );
      expect(m.coveredLinks, `section links covered at ${y}`).toBe(0);
    }
    // The rail really stuck for part of the scroll (it does not just scroll away with the page).
    expect(stuckStops).toBeGreaterThan(0);
  });
}

test("a short desktop viewport scrolls the rail itself and reaches Edit preferences (#297)", async ({
  page,
}) => {
  await openTrip(page, { width: 1024, height: 420 });
  const rail = page.locator(".trip-layout .side");
  const sizes = await rail.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  await page.evaluate(() => scrollTo(0, 500));
  await rail.hover();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => rail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // The page behind does not scroll while the wheel is over the rail.
  expect(await page.evaluate(() => scrollY)).toBe(before);
  const inside = await page.evaluate(() => {
    const r = document.querySelector(".trip-layout .side")!.getBoundingClientRect();
    const b = [...document.querySelectorAll(".trip-layout .side button")]
      .find((x) => x.textContent === "Edit preferences")!
      .getBoundingClientRect();
    return b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
  });
  expect(inside).toBe(true);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 900, height: 700 },
  { width: 320, height: 640 },
] as const) {
  test(
    `a long section label wraps without overflowing at ${size.width}px (#297)`,
    size.width <= 390 ? DEVICE : {},
    async ({ page }) => {
      await openTrip(page, size);
      await page.evaluate(() => {
        const a = document.querySelector(".sections-panel a")!;
        a.textContent = `${"Long section label ".repeat(4)} ${"x".repeat(40)}`;
      });
      const fit = await page.evaluate(() => {
        const a = document.querySelector(".sections-panel a")!;
        return {
          link: a.scrollWidth <= a.clientWidth,
          page: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(fit).toEqual({ link: true, page: true });
    },
  );
}

for (const size of [
  { width: 899, height: 700 },
  { width: 390, height: 700 },
] as const) {
  test(
    `nothing in the body is sticky below 900 at ${size.width}px (#297)`,
    size.width <= 390 ? DEVICE : {},
    async ({ page }) => {
      await openTrip(page, size);
      const positions = await page.evaluate(() => [
        getComputedStyle(document.querySelector(".trip-layout .side")!).position,
        getComputedStyle(document.querySelector(".sections-panel")!).position,
      ]);
      expect(positions).toEqual(["static", "static"]);
    },
  );
}
