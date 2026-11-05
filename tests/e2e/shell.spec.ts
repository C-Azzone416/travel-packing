import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Every screen is behind sign-in; these tests run as the allowlisted owner (e2e-only fake sign-in).
test.beforeEach(async ({ page }) => {
  await signInAsOwner(page);
});

const SCREENS = [
  { label: "Trips", path: "/", title: "Trips · Packed Smart" },
  { label: "Staples", path: "/staples", title: "Staples · Packed Smart" },
  { label: "Settings", path: "/settings", title: "Settings · Packed Smart" },
];

test(
  "navigation reaches all three screens with titles, current state and focus on main",
  DEVICE,
  async ({ page }, testInfo) => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    // Phone tabs: Trips, Staples, Settings. The laptop top menu adds Stamps (#383).
    await expect(nav.getByRole("link")).toHaveCount(testInfo.project.name === "phone" ? 3 : 4);
    // Start on Trips, so every click below is a real route change.
    for (const screen of [...SCREENS.slice(1), SCREENS[0]]) {
      await nav.getByRole("link", { name: screen.label }).click();
      await expect(page).toHaveURL(screen.path);
      await expect(page).toHaveTitle(screen.title);
      // Trips and Staples lead with their prototype headlines; Settings leads with its name.
      const heading =
        screen.label === "Trips"
          ? "Your travel ledger"
          : screen.label === "Staples"
            ? "Staples"
            : screen.label;
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(nav.getByRole("link", { name: screen.label })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.locator("main")).toBeFocused();
    }
  },
);

test("skip link is the first tab stop and jumps to main", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("keyboard focus is clearly visible", async ({ page }) => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
  });
  // The second Tab lands on the brand link in the paper header: the redesign's --info ring (Ocean #3b7f91).
  expect(outline).toEqual({ width: "3px", style: "solid", color: "rgb(59, 127, 145)" });
});

test(
  "touch targets are at least 44px on a phone; the laptop pills are 40px (#383)",
  DEVICE,
  async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "phone";
    const targets = [
      page.getByRole("link", { name: /go to trips/i }),
      ...(await page.getByRole("navigation").getByRole("link").all()),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(phone ? 44 : 40);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(phone ? 44 : 40);
    }
  },
);

test("no horizontal scroll at 320px", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, screen.path).toBeLessThanOrEqual(0);
  }
});

test(
  "navigation is a floating bottom bar on phones and a paper top menu on a laptop",
  DEVICE,
  async ({ page }, testInfo) => {
    const viewport = page.viewportSize()!;
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    if (testInfo.project.name === "phone") {
      const box = (await nav.boundingBox())!;
      // Floats 8px above the bottom edge (plus the safe area), 12px in from each side.
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 24);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8 + 0.5);
      expect(Math.round(box.x)).toBe(12);
      expect(Math.round(box.height)).toBe(60);
    } else {
      // The floating paper bar (#383): 64px high, 20px from the top, with the pills in one row inside it.
      const bar = (await page.locator(".topbar-inner").boundingBox())!;
      expect(Math.round(bar.height)).toBe(64);
      expect(Math.round(bar.y)).toBe(20);
      const links = await nav.getByRole("link").all();
      for (const link of links) {
        const box = (await link.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(bar.y);
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
        expect(Math.round(box.height)).toBe(40);
      }
      const tops = await Promise.all(links.map(async (link) => (await link.boundingBox())!.y));
      expect(new Set(tops.map(Math.round)).size).toBe(1);
      // Nothing is pinned to the left edge below the bar, and main starts under it with 26px of padding.
      const main = (await page.locator("main").boundingBox())!;
      expect(Math.round(main.y - (bar.y + bar.height))).toBe(0);
      expect(await page.locator("main").evaluate((n) => getComputedStyle(n).paddingTop)).toBe(
        "26px",
      );
      // The current page is a dark pill.
      const current = nav.locator('a[aria-current="page"]');
      expect(await current.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        "rgb(20, 43, 59)",
      );
    }
  },
);

test("screenshots of each screen", DEVICE, async ({ page }, testInfo) => {
  // Reduced motion skips the entrance animation so captures are the final frame.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-${screen.label.toLowerCase()}.png`,
      fullPage: true,
    });
  }
});
