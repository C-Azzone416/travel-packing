import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Historical wording for past trip cards (#301). A fixed clock: San Diego is upcoming (Oct 23–27), Lisbon is past
// (Sep 3–7) and seeded fully packed and Ready (31 of 31, the bag included). Trips are stored in the e2e database,
// so each test starts from the freshly seeded owner.
//
// The "Review bag" link is the separate commit (b691527). Its assertions live only in the last describe block, so a
// veto (revert b691527 and delete that block) leaves the wording tests as they are.
const NOW = new Date("2026-10-16T12:00:00");

const tab = (page: Page, name: RegExp) => page.getByRole("button", { name });
const card = (page: Page, name: string) => page.getByRole("article", { name });
const progressbar = (page: Page, destination: string) =>
  page.getByRole("progressbar", { name: `${destination} packing progress` });

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

/** The past card for a trip, once the Past & archive tab is open. */
async function pastCard(page: Page, name: string): Promise<Locator> {
  await tab(page, /Past & archive/).click();
  return card(page, name);
}

/** Every visible piece of copy the wording change touches, on one past card. */
async function expectPastCard(
  page: Page,
  name: string,
  copy: { chip: string; valueText: string; progress: string },
) {
  const article = await pastCard(page, name);
  // The chip's text starts with its glyph (aria-hidden, ✓ or ○), then the copy.
  await expect(article.locator(".status-pill")).toHaveText(new RegExp(`^[✓○]?${copy.chip}$`));
  await expect(article.locator(".progress-copy > span")).toHaveCount(1);
  await expect(article.locator(".progress-copy > span")).toHaveText(copy.progress);
  await expect(progressbar(page, name)).toHaveAttribute("aria-valuetext", copy.valueText);
  await expect(article).not.toContainText(/left/i);
}

/**
 * Lisbon's review screen, from the card's trip link (whatever its label, so this works with or without the
 * Review bag commit). The trip screen only links to the review once everything is packed, so go to /review directly.
 */
async function openLisbonReview(page: Page) {
  const article = await pastCard(page, "Lisbon");
  const href = await article
    .locator('a[href^="/trips/"]:not([href^="/trips/new"])')
    .first()
    .getAttribute("href");
  expect(href).toMatch(/^\/trips\/[^/]+$/);
  await page.goto(`${href}/review`);
  await expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();
}

/** Unchecks the first packed item on Lisbon's review, which takes the trip out of Ready (review.spec). */
async function uncheckOneOnLisbon(page: Page) {
  await openLisbonReview(page);
  await page
    .getByRole("button", { name: /mark unpacked$/ })
    .first()
    .click();
  await expect(page.getByText(/^No longer ready: an item was unchecked$/)).toBeVisible();
  await page.goto("/");
}

test(
  "past trip cards say what was packed; the upcoming card keeps its wording",
  { tag: DEVICE.tag },
  async ({ page }) => {
    await openDashboard(page);

    // Upcoming, unchanged: San Diego is the next departure (the hero), which still says what is left and
    // links to "Continue packing".
    await expect(progressbar(page, "San Diego")).toHaveAttribute("aria-valuetext", "19% packed");
    await expect(page.getByText("26 left", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue packing: San Diego" })).toBeVisible();

    // Past, seeded Ready: Marked Ready with the counts.
    await expectPastCard(page, "Lisbon", {
      chip: "Marked Ready",
      valueText: "Marked Ready, packed 31 of 31 (100%)",
      progress: "100% packed",
    });

    // Past, partly packed. The counts are read back from the card, so the copy is checked against the real numbers.
    await uncheckOneOnLisbon(page);
    await pastCard(page, "Lisbon");
    const bar = await progressbar(page, "Lisbon").getAttribute("aria-valuetext");
    const match = /^Packed (\d+) of 31 \((\d+)%\)$/.exec(bar ?? "");
    expect(match, `partly packed copy, got ${bar}`).not.toBeNull();
    await expectPastCard(page, "Lisbon", {
      chip: `Packed ${match![1]} of 31`,
      valueText: bar!,
      progress: `${match![2]}% packed`,
    });

    // Past, fully packed and not Ready: pack everything again (the trip stays out of Ready), then All 31 packed.
    await openLisbonReview(page);
    const unpacked = page.getByRole("button", { name: /^Mark packed/ });
    while ((await unpacked.count()) > 0) {
      const before = await unpacked.count();
      await unpacked.first().click();
      await expect.poll(() => unpacked.count()).toBeLessThan(before);
      const notYet = page.getByRole("dialog").getByRole("button", { name: "Not yet" });
      if (await notYet.isVisible()) await notYet.click();
    }
    const placeBag = page.getByRole("button", { name: "Put bag in suitcase" });
    if (await placeBag.count()) {
      await placeBag.click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    }
    await page.goto("/");
    await expectPastCard(page, "Lisbon", {
      chip: "All 31 packed",
      valueText: "All 31 packed (100%)",
      progress: "100% packed",
    });
  },
);

test(
  "a trip that ended yesterday is past; one that ends today is still upcoming",
  { tag: DEVICE.tag },
  async ({ page }) => {
    await openDashboard(page);

    // Ends 2026-10-15, the day before the fixed today: past, historical wording, not Ready.
    await page.goto("/");
    await page.getByRole("link", { name: /Plan a trip/ }).click();
    await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
    await page.getByRole("option", { name: /Paris/ }).click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-10-13");
    await page.getByLabel("Return", { exact: true }).fill("2026-10-15");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.getByRole("link", { name: /Plan a trip/ })).toBeVisible();

    await page.goto("/");
    const paris = await pastCard(page, "Paris");
    await expect(paris.getByText("Past trip")).toBeVisible();
    await expect(paris.locator(".status-pill")).toHaveText(/^○?Packed 0 of \d+$/);
    await expect(paris.locator(".progress-copy > span")).toHaveText("0% packed");
    await expect(paris).not.toContainText(/left/i);

    // Ends 2026-10-16, today: not past, so it stays upcoming with today's wording.
    await page.goto("/");
    await page.getByRole("link", { name: /Plan a trip/ }).click();
    await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
    await page.getByRole("option", { name: /Paris/ }).click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-10-14");
    await page.getByLabel("Return", { exact: true }).fill("2026-10-16");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.getByRole("link", { name: /Plan a trip/ })).toBeVisible();

    await page.goto("/");
    const upcoming = card(page, "Paris");
    await expect(upcoming).toBeVisible();
    await expect(upcoming.getByText("Past trip")).toHaveCount(0);
    // Paris is under way, so the dashboard shows it as the next departure: it keeps today's progress wording
    // ("N% packed") and its packing link.
    await expect(progressbar(page, "Paris")).toHaveAttribute("aria-valuetext", "0% packed");
    await expect(
      page.getByRole("link", { name: /^(Continue|Keep) packing: Paris$/ }),
    ).toBeVisible();
  },
);

// ---------------------------------------------------------------------------------------------------------------
// VETO BLOCK (#301 commit b691527, "Review bag" on past cards). To drop it: delete this describe block.
// ---------------------------------------------------------------------------------------------------------------
test.describe("Review bag on past cards (veto block)", () => {
  test(
    "a past trip that is not Ready offers Review bag, never Keep packing",
    { tag: DEVICE.tag },
    async ({ page }) => {
      await openDashboard(page);
      await uncheckOneOnLisbon(page);
      const article = await pastCard(page, "Lisbon");
      await expect(article.getByRole("link", { name: "Review bag: Lisbon" })).toBeVisible();
      await expect(
        article.getByRole("link", { name: /Keep packing|Continue packing/ }),
      ).toHaveCount(0);
    },
  );
});
