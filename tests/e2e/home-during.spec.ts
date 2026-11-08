import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { enlargeText, expectWholeWords, overflow } from "./helpers/layout";

// The Home while the trip is on and after it (#410; spec #393 part 1 sections 2.2 and 2.3). The seed has San Diego
// (2026-10-23 to 2026-10-27, so five days) and Lisbon (ended 2026-09-07). Every test fixes the clock: the day of the trip and
// the Welcome home window never depend on the real date.
const DAY_3 = new Date("2026-10-25T12:00:00");
const LAST_DAY = new Date("2026-10-27T12:00:00");
const NEXT_DAY = new Date("2026-10-28T12:00:00");
const AFTER_WINDOW = new Date("2026-11-11T12:00:00");

async function open(
  page: Page,
  width: number,
  now: Date,
  { reducedMotion = true }: { reducedMotion?: boolean } = {},
) {
  await page.setViewportSize({ width, height: width < 400 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.clock.setFixedTime(now);
  await signInAsOwner(page);
}

const tag = (page: Page) => page.getByRole("region", { name: "San Diego" });

test.describe("laptop (1280)", () => {
  test("day 3: ON NOW, Day 3 of 5 and Open list instead of the countdown", async ({ page }) => {
    await open(page, 1280, DAY_3);
    await expect(tag(page)).toContainText("ON NOW · Fri 23 – Tue 27 Oct");
    await expect(tag(page)).toContainText("Day 3 of 5");
    await expect(page.getByText("NEXT TRIP")).toHaveCount(0);
    await expect(page.getByText(/days to go/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open list: San Diego/ })).toBeVisible();
    // The chip is the accent colour, not the tint: the one coloured chip on the page.
    const [chip, accent, tint] = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith("ON NOW"),
      );
      const probe = (token: string) => {
        const span = document.createElement("span");
        span.style.background = `var(${token})`;
        document.body.append(span);
        const colour = getComputedStyle(span).backgroundColor;
        span.remove();
        return colour;
      };
      return [getComputedStyle(el!).backgroundColor, probe("--accent"), probe("--tint")];
    });
    expect(chip).toBe(accent);
    expect(chip).not.toBe(tint);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("the last day says Last day", async ({ page }) => {
    await open(page, 1280, LAST_DAY);
    await expect(tag(page)).toContainText("ON NOW");
    await expect(tag(page)).toContainText("Last day");
    await expect(tag(page)).not.toContainText("Day 5 of 5");
  });

  test("the day before it starts is still NEXT TRIP with a countdown and no day badge", async ({
    page,
  }) => {
    await open(page, 1280, new Date("2026-10-22T12:00:00"));
    await expect(tag(page)).toContainText("NEXT TRIP");
    await expect(tag(page)).toContainText("1 day to go");
    await expect(page.getByText(/Day \d of/)).toHaveCount(0);
  });

  test("stickers stay dashed through the trip and ink the day after", async ({ page }) => {
    await open(page, 1280, DAY_3);
    await page.goto("/stamps");
    const sticker = page.getByRole("button", { name: "San Diego, Oct 2026, 1 trip" });
    await expect(sticker).toHaveAttribute("data-upcoming", "true");
    await expect(sticker).toHaveCSS("border-top-style", "dashed");
    await page.clock.setFixedTime(NEXT_DAY);
    await page.reload();
    const inked = page.getByRole("button", { name: "San Diego, Oct 2026, 1 trip" });
    await expect(inked).not.toHaveAttribute("data-upcoming", "true");
    await expect(inked).toHaveCSS("border-top-style", "solid");
  });
});

test.describe("Welcome home", () => {
  test("laptop: the card above the Home, the sticker inks, and it is gone for good once dismissed", async ({
    page,
  }) => {
    await open(page, 1280, NEXT_DAY, { reducedMotion: false });
    const card = page.locator("[data-welcome-home]");
    await expect(card).toBeVisible();
    await expect(card.getByText("WELCOME HOME")).toBeVisible();
    await expect(card.getByRole("heading", { name: "San Diego is inked." })).toBeVisible();
    await expect(card).toContainText(/is in your Stamps\. 4 nights, \d+ of \d+ packed\./);
    // The sticker starts as the dashed placeholder and inks over 600 ms; the status line is read once it has.
    await expect(card.locator("[data-shape]")).not.toHaveAttribute("data-upcoming", "true");
    await expect(card.getByRole("status")).toHaveText("San Diego sticker added to Stamps.");
    await expect(card.getByRole("link", { name: "See stamps" })).toHaveAttribute(
      "href",
      /^\/stamps\?trip=/,
    );
    // It sits above the Home, full width.
    const cardBox = (await card.boundingBox())!;
    const bag = (await page
      .getByRole("region", { name: /In the bag|Where to next/ })
      .first()
      .boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(bag.y + 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await expect(page.locator("[data-welcome-home]")).toHaveCount(0);
  });

  test("it is solid at once under reduced motion", async ({ page }) => {
    await open(page, 1280, NEXT_DAY);
    const card = page.locator("[data-welcome-home]");
    await expect(card.locator("[data-shape]")).not.toHaveAttribute("data-upcoming", "true");
    await expect(card.getByRole("status")).toHaveText("San Diego sticker added to Stamps.");
  });

  test("opening Stamps from the card keeps it away, and it is gone after 14 days", async ({
    page,
  }) => {
    await open(page, 1280, NEXT_DAY);
    await page.getByRole("link", { name: "See stamps" }).click();
    await expect(page).toHaveURL(/\/stamps\?trip=/);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await expect(page.locator("[data-welcome-home]")).toHaveCount(0);
    await page.clock.setFixedTime(AFTER_WINDOW);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await expect(page.locator("[data-welcome-home]")).toHaveCount(0);
  });
});

test.describe("phone (390)", DEVICE, () => {
  test("day 3: ON NOW with the dates, Day 3 of 5, Open list, no sideways scroll", async ({
    page,
  }) => {
    await open(page, 390, DAY_3);
    await expect(tag(page)).toContainText("ON NOW · 23–27 Oct · 4 nights");
    await expect(tag(page)).toContainText("Day 3 of 5");
    await expect(page.getByText(/days to go|NEXT TRIP/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open list: San Diego/ })).toBeVisible();
    await expectWholeWords(tag(page), "phone tag during the trip");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("the last day says Last day", async ({ page }) => {
    await open(page, 390, LAST_DAY);
    await expect(tag(page)).toContainText("Last day");
    await expectWholeWords(tag(page), "phone tag on the last day");
  });

  test("Welcome home: the card above the tag area, with See stamps full width", async ({
    page,
  }) => {
    await open(page, 390, NEXT_DAY);
    const card = page.locator("[data-welcome-home]");
    await expect(card.getByRole("heading", { name: "San Diego is inked." })).toBeVisible();
    await expectWholeWords(card, "phone Welcome home card");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("phone (195)", DEVICE, () => {
  for (const [name, now] of [
    ["day 3", DAY_3],
    ["the last day", LAST_DAY],
  ] as const) {
    test(`${name}: the ON NOW chip and the badge break only between words`, async ({ page }) => {
      await open(page, 195, now);
      await expect(tag(page)).toContainText("ON NOW");
      await expectWholeWords(tag(page), `195 tag, ${name}`);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("Welcome home wraps between words", async ({ page }) => {
    await open(page, 195, NEXT_DAY);
    await expectWholeWords(page.locator("[data-welcome-home]"), "195 Welcome home");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("Welcome home at 200% text stays inside, with both buttons reachable", async ({ page }) => {
    await open(page, 195, NEXT_DAY);
    const card = page.locator("[data-welcome-home]");
    await enlargeText(page, card.getByRole("heading"));
    await expectWholeWords(card, "195 Welcome home at 200% text");
    // The card itself stays inside the 195px viewport. (The returning Home below it already runs 25px wide at 200% text:
    // its recent-trip rows, not this card; a follow-up of #409.)
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(195);
    for (const name of ["See stamps", "Dismiss"]) {
      const target = (await card
        .getByRole(name === "Dismiss" ? "button" : "link", { name })
        .boundingBox())!;
      expect(target.x + target.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });
});
