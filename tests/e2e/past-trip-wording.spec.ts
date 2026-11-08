import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import { openPastAndArchive, planATrip } from "./helpers/menu";
import { reviewSheet } from "./helpers/packing";
import { planAndCreate } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// Historical wording for past trip cards (#301). A fixed clock: San Diego is upcoming (Oct 23–27), Lisbon is past
// (Sep 3–7) and seeded fully packed and Ready (28 of 28, the bag included). Trips are stored in the e2e database,
// so each test starts from the freshly seeded owner.
//
// The "Review bag" link is the separate commit (b691527). Its assertions live only in the last describe block, so a
// veto (revert b691527 and delete that block) leaves the wording tests as they are.
const NOW = new Date("2026-10-16T12:00:00");

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
  await openPastAndArchive(page);
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
 * Lisbon's "Review your bag" sheet, from the card's trip link (whatever its label, so this works with or without the
 * Review bag commit). /review forwards to the Packing page with the sheet open (#411), so go there directly.
 */
async function openLisbonReview(page: Page) {
  const article = await pastCard(page, "Lisbon");
  const href = await article
    .locator('a[href^="/trips/"]:not([href^="/trips/new"])')
    .first()
    .getAttribute("href");
  expect(href).toMatch(/^\/trips\/[^/]+$/);
  await page.goto(`${href}/review`);
  await expect(reviewSheet(page)).toBeVisible();
}

/** Unchecks the first packed item on Lisbon's review, which takes the trip out of Ready (review.spec). */
async function uncheckOneOnLisbon(page: Page) {
  await openLisbonReview(page);
  await reviewSheet(page).getByRole("checkbox", { checked: true }).first().uncheck();
  await expect(page.getByText(/^No longer ready: an item was unchecked$/)).toBeVisible();
  await page.goto("/");
}

test(
  "past trip cards say what was packed; the upcoming card keeps its wording",
  { tag: DEVICE.tag },
  async ({ page }) => {
    await openDashboard(page);

    // Upcoming: San Diego is the next departure (the phone Home's tag). Its Pack panel counts what is in the bag and
    // links to "Continue packing"; there is no past-trip wording on it.
    await expect(page.getByRole("heading", { name: /in the bag/ })).toHaveText(
      /^\d+ \/ \d+ in the bag$/,
    );
    await expect(page.getByRole("link", { name: "Continue packing: San Diego" })).toBeVisible();
    await expect(page.getByText(/Marked Ready|Past trip|Archived trip/)).toHaveCount(0);

    // Past, seeded Ready: Marked Ready with the counts.
    await expectPastCard(page, "Lisbon", {
      chip: "Marked Ready",
      valueText: "Marked Ready, packed 28 of 28 (100%)",
      progress: "100% packed",
    });

    // Past, partly packed. The counts are read back from the card, so the copy is checked against the real numbers.
    await uncheckOneOnLisbon(page);
    await pastCard(page, "Lisbon");
    const bar = await progressbar(page, "Lisbon").getAttribute("aria-valuetext");
    const match = /^Packed (\d+) of 28 \((\d+)%\)$/.exec(bar ?? "");
    expect(match, `partly packed copy, got ${bar}`).not.toBeNull();
    await expectPastCard(page, "Lisbon", {
      chip: `Packed ${match![1]} of 28`,
      valueText: bar!,
      progress: `${match![2]}% packed`,
    });

    // Past, fully packed and not Ready: pack everything again (the trip stays out of Ready), then All 28 packed.
    await openLisbonReview(page);
    const unpacked = reviewSheet(page).getByRole("checkbox", { checked: false });
    while ((await unpacked.count()) > 0) {
      const before = await unpacked.count();
      await unpacked.first().check();
      await expect.poll(() => unpacked.count()).toBeLessThan(before);
    }
    const placeBag = reviewSheet(page).getByRole("button", { name: "Put bag in suitcase" });
    if (await placeBag.count()) {
      await placeBag.click();
      await expect(reviewSheet(page).getByRole("button", { name: "Undo placement" })).toBeVisible();
    }
    await page.goto("/");
    await expectPastCard(page, "Lisbon", {
      chip: "All 28 packed",
      valueText: "All 28 packed (100%)",
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
    await planATrip(page);
    await planAndCreate(page, {
      query: "paris",
      option: /Paris/,
      start: "2026-10-13",
      end: "2026-10-15",
    });
    await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();

    await page.goto("/");
    const paris = await pastCard(page, "Paris");
    await expect(paris.getByText("Past trip")).toBeVisible();
    await expect(paris.locator(".status-pill")).toHaveText(/^○?Packed 0 of \d+$/);
    await expect(paris.locator(".progress-copy > span")).toHaveText("0% packed");
    await expect(paris).not.toContainText(/left/i);

    // Ends 2026-10-16, today: not past, so it stays upcoming with today's wording.
    await page.goto("/");
    await planATrip(page);
    await planAndCreate(page, {
      query: "paris",
      option: /Paris/,
      start: "2026-10-14",
      end: "2026-10-16",
    });
    await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Paris" })).toBeVisible();
    await expect(page.getByText("Past trip")).toHaveCount(0);
    // Paris is under way, so the phone Home shows it as the next trip: nothing packed, and its packing link.
    await expect(page.getByRole("heading", { name: /in the bag/ })).toHaveText(
      /^0 \/ \d+ in the bag$/,
    );
    await expect(
      page.getByRole("link", { name: /^(Continue packing|Start packing|Open list): Paris$/ }),
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
