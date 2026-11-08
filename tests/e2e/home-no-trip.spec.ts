import { expect, test, type Page } from "@playwright/test";
import { enlargeText, expectWholeWords, overflow } from "./helpers/layout";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { clearOwnerTrips, setOwnerHomeCity } from "./helpers/database";
import { DEVICE } from "./helpers/device";

// The Home with no trip coming up (#409): the first-run welcome (an empty dashed suitcase) and the returning welcome (the
// Stamps teaser and the latest trips), on the laptop (1280) and the phone (390, and 195 for whole-word wrapping). The seed
// has San Diego (2026-10-23) and Lisbon, so a clock after both makes the account "returning"; deleting every trip makes it
// first run. The home city starts unset (resetOwnerData), which is what shows the nudge.
const RETURNING_NOW = new Date("2026-12-01T12:00:00");
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;
const SEATTLE = {
  id: "us-wa-seattle",
  city: "Seattle",
  region: "Washington",
  country: "United States",
  countryCode: "US",
  label: "Seattle, Washington, United States",
};
const WHERE = /^Where to (first|next)\?$/;

async function open(page: Page, width: number, { firstRun }: { firstRun: boolean }) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(RETURNING_NOW);
  await signInAsOwner(page);
  if (firstRun) {
    await clearOwnerTrips(ownerId());
    await page.goto("/");
  }
  await expect(page.getByRole("heading", { name: WHERE })).toBeVisible();
}

test.afterEach(async () => {
  await setOwnerHomeCity(ownerId(), null);
});

test("laptop first run: Where to first?, the nudge, and an empty dashed suitcase", async ({
  page,
}) => {
  await open(page, 1280, { firstRun: true });
  await expect(page.getByRole("heading", { name: "Where to first?" })).toBeVisible();
  await expect(page.getByText("WELCOME", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Plan a trip" })).toHaveAttribute(
    "href",
    "/trips/new",
  );
  await expect(page.getByRole("link", { name: "Set up your Staples" })).toHaveAttribute(
    "href",
    "/staples",
  );
  const nudge = page.getByRole("link", { name: /Set your home city so trips know/ });
  await expect(nudge).toHaveAttribute("href", "/settings");
  // The suitcase is decorative: five dashed cubes, no stamps row on the laptop, no pills, no tag.
  const suitcase = page.locator("[data-empty-suitcase]");
  await expect(suitcase).toHaveAttribute("aria-hidden", "true");
  await expect(suitcase.locator("li")).toHaveCount(5);
  await expect(page.getByRole("link", { name: /Your stamps will collect here/ })).toHaveCount(0);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // The nudge goes away once the home city is set.
  await setOwnerHomeCity(ownerId(), SEATTLE);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Where to first?" })).toBeVisible();
  await expect(nudge).toHaveCount(0);
});

test("laptop returning: Where to next?, the Stamps teaser and the recent trips", async ({
  page,
}) => {
  await open(page, 1280, { firstRun: false });
  await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  await expect(page.getByText("WELCOME BACK")).toBeVisible();
  await expect(page.getByText("Your Staples are ready to start the list.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Stickers · Last 12 months/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "All stamps ›" })).toHaveAttribute("href", "/stamps");
  const recent = page.getByRole("region", { name: "Recent trips" });
  await expect(recent.getByRole("link")).toHaveCount(2);
  await expect(recent.getByRole("link", { name: /Lisbon/ })).toHaveAttribute(
    "href",
    /\/stamps\?trip=/,
  );
  // The teaser stickers are decoration: no sticker is a control.
  await expect(page.locator('[data-decorative="true"]').first()).toBeAttached();
  await expect(page.getByRole("button", { name: /, 1 trip$/ })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // A recent trip opens on the Stamps page with that trip selected.
  await recent.getByRole("link", { name: /Lisbon/ }).click();
  await expect(page).toHaveURL(/\/stamps\?trip=/);
  await expect(page.getByRole("article", { name: "Selected trip: Lisbon" })).toBeVisible();
});

test(
  "phone first run: the hero, the nudge, the empty suitcase and the Stamps row",
  DEVICE,
  async ({ page }) => {
    await open(page, 390, { firstRun: true });
    await expect(page.getByRole("heading", { name: "Where to first?" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Set your home city so trips know/ }),
    ).toBeVisible();
    await expect(page.locator("[data-empty-suitcase] li")).toHaveCount(5);
    await expect(
      page.getByRole("link", { name: "Your stamps will collect here ›" }),
    ).toHaveAttribute("href", "/stamps");
    await expect(page.getByRole("tablist", { name: "Trip sections" })).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  },
);

test(
  "phone returning: the hero, three recent trips at most and All stamps",
  DEVICE,
  async ({ page }) => {
    await open(page, 390, { firstRun: false });
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent trips" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Recent trips" }).getByRole("link", { name: /Lisbon/ }),
    ).toBeVisible();
    // No teaser suitcase on the phone: the dashed row is the way to the stamps.
    await expect(page.getByRole("heading", { name: /^Stickers/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All stamps ›" })).toHaveAttribute(
      "href",
      "/stamps",
    );
    await expect(page.getByRole("tablist", { name: "Trip sections" })).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  },
);

for (const firstRun of [true, false]) {
  test(
    `195px ${firstRun ? "first run" : "returning"}: no sideways scroll and every word wraps whole`,
    DEVICE,
    async ({ page }) => {
      await open(page, 195, { firstRun });
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectWholeWords(page.locator("main"), `no-trip Home at 195px`);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectWholeWords(page.locator("main"), `no-trip Home at 195px, 200% text`);
    },
  );
}

// The hero title (#467) is pixel-sized, so the root font-size change above leaves it alone: double every size instead, as a
// person with a large text setting gets it, and the title must still wrap whole words in both states.
for (const firstRun of [true, false]) {
  test(
    `195px ${firstRun ? "first run" : "returning"}, doubled text: the hero title wraps whole words`,
    DEVICE,
    async ({ page }) => {
      await open(page, 195, { firstRun });
      const title = page.getByRole("heading", { name: WHERE });
      const factor = await enlargeText(page, title);
      expect(factor, "the page text doubled before it is measured").toBeGreaterThanOrEqual(1.9);
      await expectWholeWords(title, `hero title at 195px, doubled text`);
    },
  );
}

// The first-run empty suitcase (#471): with doubled text its cube names ("Documents") must not push the page sideways,
// every word across the whole Home must wrap whole, and each name must sit inside its own tile. The widths cover the
// one-column band (195, 256, 270, 320) and the three-column edge (359).
// Each cube's name text, measured by its Range rects, must sit inside its own tile.
const spilledNames = (page: Page) =>
  page.locator("[data-empty-suitcase] li").evaluateAll((cubes) =>
    cubes
      .map((cube) => {
        const name = cube.querySelector("span");
        if (!name) return null;
        const tile = cube.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(name);
        const outside = Array.from(range.getClientRects()).some(
          (box) => box.right > tile.right + 0.5 || box.left < tile.left - 0.5,
        );
        return outside ? (cube.textContent ?? "").slice(0, 12) : null;
      })
      .filter((text) => text !== null),
  );

for (const width of [195, 256, 270, 320, 359]) {
  test(
    `${width}px first run, doubled text: no sideways scroll, whole words, names inside their cubes`,
    DEVICE,
    async ({ page }) => {
      await open(page, width, { firstRun: true });
      const factor = await enlargeText(page, page.getByRole("heading", { name: WHERE }));
      expect(factor, "the page text doubled before it is measured").toBeGreaterThanOrEqual(1.9);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectWholeWords(page.locator("main"), `first-run Home at ${width}px, doubled text`);
      expect(
        await spilledNames(page),
        `cube names inside their tiles at ${width}px, doubled text`,
      ).toEqual([]);
    },
  );
}

test(
  "320px first run, normal text: names inside their cubes and whole words",
  DEVICE,
  async ({ page }) => {
    await open(page, 320, { firstRun: true });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectWholeWords(page.locator("main"), "first-run Home at 320px, normal text");
    expect(await spilledNames(page), "cube names inside their tiles at 320px, normal text").toEqual(
      [],
    );
  },
);

// The returning Home's recent-trip rows (#463) at 195px with doubled text: the px-sized rules double too (enlargeText), which a
// root font-size change alone does not do. The page must not scroll sideways, and the recent trips must wrap whole words.
test(
  "195px returning, doubled text: the recent-trip rows wrap whole with no sideways scroll",
  DEVICE,
  async ({ page }) => {
    await open(page, 195, { firstRun: false });
    const recent = page.getByRole("region", { name: "Recent trips" });
    const factor = await enlargeText(page, recent.getByRole("link").first().locator("strong"));
    expect(factor, "the page text doubled before it is measured").toBeGreaterThanOrEqual(1.9);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectWholeWords(recent, "recent trips at 195px, doubled text");
  },
);
