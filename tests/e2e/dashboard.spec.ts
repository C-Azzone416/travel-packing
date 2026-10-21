import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// A fixed clock keeps the seeded sample trips stable: San Diego upcoming, Lisbon past. (Trip ids are the real
// database's uuids, so tests find a trip's panels by role/name or `aria-controls`, never by a fixture id.)
const NOW = new Date("2026-10-16T12:00:00");

// Every route needs the owner's session, so each test signs in first. `signedIn` is true for a page
// opened in a context that already has the session cookie.
async function openDashboard(page: Page, { signedIn = false } = {}) {
  await page.clock.setFixedTime(NOW);
  if (signedIn) await page.goto("/");
  else await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });
const tab = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("archive -> appears in Past & archive -> restore -> back in Upcoming", async ({ page }) => {
  await openDashboard(page);
  await card(page, "San Diego").getByRole("button", { name: "Archive: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);
  await expect(page.getByText("No upcoming trips.")).toBeVisible();

  await tab(page, /Past & archive/).click();
  const archived = card(page, "San Diego");
  await expect(archived.getByText("Archived trip")).toBeVisible();
  await archived.getByRole("button", { name: "Restore: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await tab(page, /Upcoming/).click();
  await expect(card(page, "San Diego")).toBeVisible();
});

test("remove -> confirm -> undo leaves the trip identical", async ({ page }) => {
  await openDashboard(page);
  const before = await card(page, "San Diego").innerText();

  await card(page, "San Diego").getByRole("button", { name: "Remove: San Diego" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove San Diego?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Remove trip" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toHaveCount(0);

  await page.locator(".toast-region").getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "San Diego")).toBeVisible();
  expect(await card(page, "San Diego").innerText()).toBe(before);
});

test("Recently deleted offers Undo remove, with no retention period shown", async ({ page }) => {
  await openDashboard(page);
  await card(page, "San Diego").getByRole("button", { name: "Remove: San Diego" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
  await tab(page, /Past & archive/).click();
  await expect(page.getByText(/30 days|retention/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo remove: San Diego" }).click();
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
});

test("quick view filters without changing progress or touching the network", async ({ page }) => {
  await openDashboard(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    // Next prefetches linked routes (?_rsc=) as links scroll into view: reads, not saves.
    if (!/\/_next\/|\.(jpg|png|css|js|woff2?)$|_rsc=/.test(request.url()))
      requests.push(`${request.method()} ${request.url()}`);
  });
  const san = card(page, "San Diego");
  const progress = await san.getByText(/of \d+ packed/).innerText();
  const chip = page.getByRole("link", { name: "Saved" });

  await san.getByRole("button", { name: /Quick view/ }).click();
  const quick = san.locator('[id^="quick-view-"]');
  await expect(quick.getByRole("button", { name: "Still to pack" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(quick.getByText("Sleepwear")).toHaveCount(0);
  await quick.getByRole("button", { name: "All" }).click();
  await expect(quick.getByText("Sleepwear")).toBeVisible();
  await quick.getByRole("button", { name: "Still to pack" }).click();

  expect(await san.getByText(/of \d+ packed/).innerText()).toBe(progress);
  await expect(chip).toBeVisible();
  expect(requests).toEqual([]);
});

test("a failed theme image swaps to the neutral surface at the same size (deferred from #13)", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  const art = card(page, "Lisbon").locator("[data-art-key]");
  await expect(art.locator("img")).toBeVisible();
  const expected = await art.boundingBox();

  const failing = await page.context().newPage();
  await failing.route("**/themes/*.svg", (route) => route.abort());
  await failing.setViewportSize(page.viewportSize()!);
  await openDashboard(failing, { signedIn: true });
  await failing.getByRole("button", { name: /Past & archive/ }).click();
  const failedArt = card(failing, "Lisbon").locator("[data-art-key]");
  await expect(failedArt).toHaveAttribute("data-art-failed", "true");
  await expect(failedArt.locator("img")).toHaveCount(0);
  await expect(failedArt).toHaveText("");
  const actual = await failedArt.boundingBox();
  expect(actual!.height).toBeCloseTo(expected!.height, 0);
  expect(actual!.width).toBeCloseTo(expected!.width, 0);
  // The neutral surface is the theme's --seafoam tint; read it the same way the art does.
  const background = (node: Element) => getComputedStyle(node).backgroundColor;
  const neutral = await failedArt.evaluate((node) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--seafoam)";
    node.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(await failedArt.evaluate(background)).toBe(neutral);
});

test("no horizontal scroll at 320px with a quick view open", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openDashboard(page);
  await card(page, "San Diego")
    .getByRole("button", { name: /Quick view/ })
    .click();
  await expect(card(page, "San Diego").locator('[id^="quick-view-"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await tab(page, /Past & archive/).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("dashboard controls are keyboard operable with 44px targets", DEVICE, async ({ page }) => {
  await openDashboard(page);
  for (const control of [
    tab(page, /Upcoming/),
    tab(page, /Past & archive/),
    card(page, "San Diego").getByRole("button", { name: /Quick view/ }),
    card(page, "San Diego").getByRole("button", { name: "Archive: San Diego" }),
    card(page, "San Diego").getByRole("button", { name: "Remove: San Diego" }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.9);
  }
  await card(page, "San Diego")
    .getByRole("button", { name: /Quick view/ })
    .focus();
  await page.keyboard.press("Enter");
  const quick = card(page, "San Diego").locator('[id^="quick-view-"]');
  await expect(quick).toBeVisible();
  for (const control of await quick.getByRole("button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
});

test("screenshots of the dashboard", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await card(page, "San Diego")
    .getByRole("button", { name: /Quick view/ })
    .click();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-dashboard.png`,
    fullPage: true,
  });
  await tab(page, /Past & archive/).click();
  await expect(card(page, "Lisbon")).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-dashboard-archive.png`,
    fullPage: true,
  });
});

test(
  "on phones the end of the page is never hidden behind the nav",
  DEVICE,
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "the bottom nav is a phone layout");
    await openDashboard(page);
    await tab(page, /Past & archive/).click();
    await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = (await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox())!;
    const last = (await page.locator(".deleted-list").boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  },
);

// Field Ledger dashboard (#143): the hero, its actions and the dark header.
test("the hero leads with the next departure; Add item opens the add form on the trip screen; Edit trip opens the route sheet", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "Your travel ledger", level: 1 })).toBeVisible();
  const hero = card(page, "San Diego");
  await expect(hero.getByText("Next departure · Oct 23")).toBeVisible();
  await expect(hero.getByText("days to go")).toBeVisible();
  await expect(hero.getByRole("link", { name: "Continue packing: San Diego" })).toBeVisible();
  // The header is the dark role token, not a hard-coded colour.
  const headerBackground = await page
    .locator("header.topbar")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const headerToken = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--header)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(headerBackground).toBe(headerToken);

  await hero.getByRole("button", { name: "Edit trip: San Diego" }).click();
  await expect(page.getByRole("dialog", { name: "Edit route" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit route" })).toHaveCount(0);

  await hero.getByRole("link", { name: "Add item: San Diego" }).click();
  await expect(page.getByRole("dialog", { name: "Add a Bathroom item" })).toBeVisible();
});

test("no horizontal scroll at 390 and 1280, and the sidebar sits beside the hero only on wide screens", async ({
  page,
}) => {
  await openDashboard(page);
  for (const [width, beside] of [
    [390, false],
    [1280, true],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const hero = await page.getByRole("article", { name: "San Diego" }).boundingBox();
    const later = await page.getByRole("complementary", { name: "Later journeys" }).boundingBox();
    expect(later!.x > hero!.x + hero!.width - 1).toBe(beside);
  }
});
