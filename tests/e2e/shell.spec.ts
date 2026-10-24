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
  async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("link")).toHaveCount(3);
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
            ? "Every trip starts here"
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
  // The second Tab lands on the brand link in the dark header: --focus-on-header (Base #fff9eb).
  expect(outline).toEqual({ width: "3px", style: "solid", color: "rgb(255, 249, 235)" });
});

test("touch targets are at least 44px", DEVICE, async ({ page }) => {
  const targets = [
    page.getByRole("link", { name: /go to trips/i }),
    page.getByRole("link", { name: "Saved" }),
    ...(await page.getByRole("navigation").getByRole("link").all()),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});

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
  "navigation is a bottom bar on phones and inline in the slim dark header on desktop",
  DEVICE,
  async ({ page }, testInfo) => {
    const viewport = page.viewportSize()!;
    if (testInfo.project.name === "phone") {
      const box = await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox();
      expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 24);
      expect(box!.width).toBeGreaterThan(viewport.width / 2);
    } else {
      // One slim bar (#155): the links sit inside the 68px header, in one row, with no rail beside the page.
      const header = (await page.locator("header.topbar").boundingBox())!;
      expect(Math.round(header.height)).toBe(68);
      const links = await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link")
        .all();
      for (const link of links) {
        const box = (await link.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(header.y);
        expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height + 1);
      }
      const tops = await Promise.all(links.map(async (link) => (await link.boundingBox())!.y));
      expect(new Set(tops.map(Math.round)).size).toBe(1);
      // Nothing is pinned to the left edge below the bar, and main starts under the bar.
      const main = (await page.locator("main").boundingBox())!;
      expect(main.y).toBeGreaterThanOrEqual(header.y + header.height);
      const current = page
        .getByRole("navigation", { name: "Primary navigation" })
        .locator('a[aria-current="page"]');
      // The current page carries a 3px underline (the ::before), on top of its bold, brighter text.
      expect(await current.evaluate((node) => getComputedStyle(node, "::before").height)).toBe(
        "3px",
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
