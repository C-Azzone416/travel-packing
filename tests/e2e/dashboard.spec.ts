import { expect, test, type Page } from "@playwright/test";

// A fixed clock keeps the synthetic trips stable: San Diego upcoming, Lisbon past.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
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
  const quick = san.locator("#quick-view-san-diego");
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

test("a failed destination image swaps to the neutral surface at the same size (deferred from #13)", async ({
  page,
}) => {
  await openDashboard(page);
  const art = card(page, "San Diego").locator("[data-art-key]");
  await expect(art.locator("img")).toBeVisible();
  const expected = await art.boundingBox();

  const failing = await page.context().newPage();
  await failing.route("**/_next/image**", (route) => route.abort());
  await failing.setViewportSize(page.viewportSize()!);
  await openDashboard(failing);
  const failedArt = card(failing, "San Diego").locator("[data-art-key]");
  await expect(failedArt).toHaveAttribute("data-art-failed", "true");
  await expect(failedArt.locator("img")).toHaveCount(0);
  await expect(failedArt).toHaveText("");
  const actual = await failedArt.boundingBox();
  expect(actual!.height).toBeCloseTo(expected!.height, 0);
  expect(actual!.width).toBeCloseTo(expected!.width, 0);
  expect(await failedArt.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    "rgb(185, 221, 208)",
  );
});

test("no horizontal scroll at 320px with a quick view open", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openDashboard(page);
  await card(page, "San Diego")
    .getByRole("button", { name: /Quick view/ })
    .click();
  await expect(page.locator("#quick-view-san-diego")).toBeVisible();
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

test("dashboard controls are keyboard operable with 44px targets", async ({ page }) => {
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
  const quick = page.locator("#quick-view-san-diego");
  await expect(quick).toBeVisible();
  for (const control of await quick.getByRole("button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
  }
});

test("screenshots of the dashboard", async ({ page }, testInfo) => {
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

test("on phones the hero sun clears the hero text, and the end of the page is never hidden behind the nav", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "phone",
    "the bottom nav and the corner sun are phone layouts",
  );
  await openDashboard(page);
  const sun = (await page.locator(".sun").boundingBox())!;
  for (const node of await page.locator(".hero-copy").locator("p, h1, .actions a").all()) {
    const text = (await node.boundingBox())!;
    const apart =
      sun.x >= text.x + text.width ||
      sun.x + sun.width <= text.x ||
      sun.y >= text.y + text.height ||
      sun.y + sun.height <= text.y;
    expect(
      apart,
      `sun overlaps ${await node.evaluate((el) => el.tagName + "." + el.className)}`,
    ).toBe(true);
  }

  await tab(page, /Past & archive/).click();
  await expect(page.getByText("Nothing recently deleted.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const nav = (await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox())!;
  const last = (await page.locator(".deleted-list").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
});
