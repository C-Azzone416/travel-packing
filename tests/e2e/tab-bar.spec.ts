import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { connectedOnTrips, fakeFramebriar, feedbackOff } from "./helpers/feedback";

// The phone tab bar (#300 icons, #293 Feedback in the 4th slot). The 4th slot is Feedback where feedback is on and Sign out where it is
// off, in the same four columns, so every geometry check runs for both and compares them. Text size is the root font size, which is
// what the browser's text-size setting changes.
test.beforeEach(() => fakeFramebriar.reset());

interface Slot {
  box: { x: number; y: number; width: number; height: number };
  label: string;
  labelBox: { left: number; right: number };
  iconCentre: number | null;
  labelCentre: number;
  overflow: number;
  svg: { width: number; height: number } | null;
}

/** The four drawn slots of the bar, with the label that is actually visible in each. */
function measure(page: Page): Promise<Slot[]> {
  return page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav")!;
    const drawn = [...nav.children].filter((el) => el.getBoundingClientRect().width > 0);
    return drawn.map((slot) => {
      const rect = slot.getBoundingClientRect();
      const labels = [
        ...slot.querySelectorAll<HTMLElement>(".nav-label, .nav-label-long, .nav-label-short"),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        // The innermost visible label (the wrapper holds the two variants).
        .filter((el) => !el.querySelector(".nav-label-long, .nav-label-short"));
      const label = labels[0];
      const labelRect = label.getBoundingClientRect();
      const icon = slot.querySelector(".nav-icon");
      const iconRect = icon?.getBoundingClientRect();
      const inner = slot.matches("form") ? slot.firstElementChild! : slot;
      return {
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        label: label.textContent ?? "",
        labelBox: { left: labelRect.left, right: labelRect.right },
        iconCentre: iconRect && iconRect.width > 0 ? iconRect.left + iconRect.width / 2 : null,
        labelCentre: labelRect.left + labelRect.width / 2,
        overflow: inner.scrollWidth - inner.clientWidth,
        svg: iconRect ? { width: iconRect.width, height: iconRect.height } : null,
      };
    });
  });
}

const SIZES = [
  { name: "390", width: 390, height: 700, text: 100, slotMin: 97 },
  { name: "320", width: 320, height: 640, text: 100, slotMin: 80 },
  { name: "390@200%", width: 390, height: 700, text: 200, slotMin: 97 },
  { name: "320@200%", width: 320, height: 640, text: 200, slotMin: 80 },
] as const;
// The 4th label under the measurable rule: "Feedback" iff it fits the slot's inner width (spec, section 3c).
const FOURTH_LABEL = {
  "390": "Feedback",
  "320": "Feedback",
  "390@200%": "Feedback",
  "320@200%": "Report",
};

async function largeText(page: Page, percent: number) {
  if (percent !== 100)
    await page.addStyleTag({ content: `html{font-size:${percent}% !important}` });
}

for (const size of SIZES) {
  test(
    `the four slots keep one geometry with Feedback on and off at ${size.name}`,
    DEVICE,
    async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signInAsOwner(page);
      await page.goto("/");
      await expect(page.locator(".nav-feedback")).toBeVisible();
      await largeText(page, size.text);
      const on = await measure(page);
      await expect(page.locator(".nav-feedback")).toBeVisible();

      await feedbackOff(page);
      await page.reload();
      await expect(
        page.getByRole("navigation").getByRole("button", { name: "Sign out" }),
      ).toBeVisible();
      await expect(page.locator(".nav-feedback")).toHaveCount(0);
      await largeText(page, size.text);
      const off = await measure(page);

      for (const [state, slots] of [
        ["on", on],
        ["off", off],
      ] as const) {
        expect(slots, `${state}: four slots`).toHaveLength(4);
        slots.forEach((slot, index) => {
          const where = `${state} slot ${index + 1} (${slot.label})`;
          expect(slot.box.width, `${where} wide`).toBeGreaterThanOrEqual(size.slotMin - 0.5);
          expect(slot.box.height, `${where} tall`).toBeGreaterThanOrEqual(44);
          // No wrapping or clipping: the label sits inside the slot's padding and nothing scrolls.
          expect(slot.labelBox.left, `${where} label left`).toBeGreaterThanOrEqual(
            slot.box.x + 3.5,
          );
          expect(slot.labelBox.right, `${where} label right`).toBeLessThanOrEqual(
            slot.box.x + slot.box.width - 3.5,
          );
          expect(slot.overflow, `${where} scroll overflow`).toBeLessThanOrEqual(0);
          expect(slot.iconCentre, `${where} icon`).not.toBeNull();
          expect(
            Math.abs(slot.iconCentre! - slot.labelCentre),
            `${where} centred`,
          ).toBeLessThanOrEqual(1);
          expect(slot.svg, `${where} icon is 24px`).toEqual({ width: 24, height: 24 });
          if (index > 0) {
            const before = slots[index - 1].box;
            expect(slot.box.x, `${where} does not overlap`).toBeGreaterThanOrEqual(
              before.x + before.width - 0.5,
            );
          }
        });
      }
      expect(on[3].label, "Feedback on: the 4th label follows the rule").toBe(
        FOURTH_LABEL[size.name],
      );
      expect(off[3].label).toBe("Sign out");
      // Section 4: the same boxes whether the 4th slot is Feedback or Sign out.
      on.forEach((slot, index) => {
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(slot.box[key], `slot ${index + 1} ${key}`).toBeCloseTo(off[index].box[key], 0);
        }
      });
    },
  );
}

test("the divider, the bottom edge and the safe area (#293)", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await signInAsOwner(page);
  await page.goto("/");
  await expect(page.locator(".nav-feedback")).toBeVisible();
  const divider = await page.locator(".nav-feedback").evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return { width: parseFloat(style.width), content: style.content, left: style.left };
  });
  expect(divider).toEqual({ width: 1, content: '""', left: "0px" });
  const nav = (await page.locator(".bottom-nav").boundingBox())!;
  expect(Math.round(nav.y + nav.height)).toBe(700);
  await page.addStyleTag({ content: ":root{--safe-bottom:34px}" });
  const inset = await page.evaluate(() => ({
    bar: document.querySelector(".bottom-nav")!.getBoundingClientRect().bottom,
    items: [...document.querySelectorAll(".bottom-nav > *")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.getBoundingClientRect().bottom),
  }));
  expect(inset.bar).toBe(700);
  for (const bottom of inset.items) expect(bottom).toBeLessThanOrEqual(700 - 34 + 0.5);
});

test("the new outline icons are drawn, not font glyphs (#300)", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await signInAsOwner(page);
  await page.goto("/");
  await expect(page.locator(".nav-feedback")).toBeVisible();
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll(".bottom-nav > *")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        svgs: el.querySelectorAll("svg.nav-icon").length,
        text: el.textContent?.replace(/\s+/g, " ").trim(),
      })),
  );
  expect(kinds.map((kind) => kind.svgs)).toEqual([1, 1, 1, 1]);
  expect(kinds.map((kind) => kind.text).join(" ")).not.toMatch(/[⌂◇⚙]/u);
});

test("the active link is tinted, Feedback never is (#300)", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await signInAsOwner(page);
  await page.goto("/staples");
  await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveCount(1);
  const fills = await page.evaluate(() => ({
    active: getComputedStyle(
      document.querySelector('.bottom-nav a[aria-current="page"] [data-fill]')!,
    ).fill,
    idle: getComputedStyle(document.querySelector(".bottom-nav a:not([aria-current]) [data-fill]")!)
      .fill,
    feedback: getComputedStyle(document.querySelector(".nav-feedback path")!).fill,
    current: document.querySelectorAll(".nav-feedback[aria-current]").length,
  }));
  expect(fills.active).not.toBe("none");
  expect(fills.idle).toBe("none");
  expect(fills.feedback).toBe("none");
  expect(fills.current).toBe(0);
});

test(
  "Feedback opens from the tab over the page you were on, focus comes back (#293)",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await connectedOnTrips(page);
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
    const tab = page.getByRole("button", { name: "Send feedback report" });
    await expect(tab).toBeEnabled();
    // A phone tap on the tab bar; the picture is taken before the sheet mounts.
    await tab.click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog).toBeVisible();
    const preview = dialog.getByRole("img", { name: /^Your screenshot\./ });
    await expect(preview).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tab).toBeFocused();
  },
);

// Keyboard order and keys: the desktop browser only (the iPhone profile has no physical keyboard, and WebKit's Tab order skips buttons).
test("Tab reaches Trips, Staples, Settings, then Feedback, each with a ring; Enter and Space open it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await connectedOnTrips(page);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const ring = (locator: Locator) =>
    locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    });
  await page.locator(".brand-button").focus();
  for (const name of ["Trips", "Staples", "Settings"]) {
    await page.keyboard.press("Tab");
    const link = nav.getByRole("link", { name });
    await expect(link).toBeFocused();
    expect(await ring(link), `${name} ring`).toBe(true);
  }
  await page.keyboard.press("Tab");
  const feedback = nav.getByRole("button", { name: "Send feedback report" });
  await expect(feedback).toBeFocused();
  expect(await ring(feedback), "Feedback ring").toBe(true);
  // Sign out is not a fifth stop on a phone.
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(feedback).not.toBeFocused();
  await feedback.focus();
  for (const key of ["Enter", "Space"]) {
    await page.keyboard.press(key);
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(feedback).toBeFocused();
  }
});

for (const width of [390, 1280]) {
  test(`no Feedback button in the top bar's end cluster at ${width}px (#293)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signInAsOwner(page);
    await page.goto("/");
    await expect(page.locator(".nav-feedback")).toBeVisible();
    await expect(page.locator(".topbar-end").getByRole("button")).toHaveCount(0);
    const where = await page.evaluate(() => ({
      bar: document.querySelector(".topbar")!.getBoundingClientRect().bottom,
      feedback: document.querySelector(".nav-feedback")!.getBoundingClientRect(),
      innerHeight,
    }));
    if (width < 721) expect(where.feedback.top).toBeGreaterThan(where.innerHeight - 100);
    else expect(where.feedback.bottom).toBeLessThanOrEqual(where.bar);
  });
}

// Desktop header (decision on #300): Feedback AND Sign out, in this order, then the save chip.
for (const width of [721, 800, 899, 900, 1280]) {
  test(`the header holds Feedback and Sign out without wrapping at ${width}px (#293)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await signInAsOwner(page);
    await page.goto("/");
    const feedback = page.locator(".nav-feedback");
    const signOut = page.locator(".nav-signout button");
    await expect(feedback).toBeVisible();
    await expect(signOut).toBeVisible();
    const facts = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const feedback = box(".nav-feedback");
      const out = box(".nav-signout button");
      const label = document.querySelector<HTMLElement>(".nav-feedback .nav-label-long")!;
      return {
        feedback: { x: feedback.x, r: feedback.right, w: feedback.width, h: feedback.height },
        out: { x: out.x, r: out.right },
        chip: document.querySelector(".sync-chip")?.getBoundingClientRect().x ?? null,
        links: [...document.querySelectorAll(".bottom-nav a")].map(
          (a) => a.getBoundingClientRect().right,
        ),
        labelShown:
          getComputedStyle(label).display !== "none" && label.getBoundingClientRect().width > 0,
        shortShown:
          getComputedStyle(document.querySelector(".nav-feedback .nav-label-short")!).display !==
          "none",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        brandOverflow: (() => {
          const brand = document.querySelector<HTMLElement>(".brand-button")!;
          return brand.scrollWidth - brand.clientWidth;
        })(),
      };
    });
    expect(facts.overflow).toBe(0);
    expect(facts.brandOverflow).toBeLessThanOrEqual(0);
    // Order and no overlap: links, then Feedback, Sign out at the right edge. A save chip, when there is one, sits left of them so
    // that it appearing never moves them.
    expect(facts.feedback.x).toBeGreaterThanOrEqual(Math.max(...facts.links) - 0.5);
    expect(facts.out.x).toBeGreaterThanOrEqual(facts.feedback.r - 0.5);
    if (facts.chip !== null) expect(facts.feedback.x).toBeGreaterThanOrEqual(facts.chip);
    expect(facts.feedback.h).toBeGreaterThanOrEqual(44);
    expect(facts.shortShown, "the Report label never shows here").toBe(false);
    if (width < 900) {
      expect(facts.labelShown, "icon only").toBe(false);
      expect(Math.round(facts.feedback.w)).toBe(44);
    } else {
      expect(facts.labelShown, "the word shows").toBe(true);
    }
    await expect(feedback).toHaveAccessibleName("Send feedback report");
  });
}

// Short landscape: below 667px wide the 48px row layout; both states.
for (const state of ["on", "off"] as const) {
  test(`568x320 landscape: a 48px row layout with Feedback ${state} (#293)`, async ({ page }) => {
    if (state === "off") await feedbackOff(page);
    await page.setViewportSize({ width: 568, height: 320 });
    await signInAsOwner(page);
    await page.goto("/");
    await expect(
      page
        .getByRole("navigation")
        .locator(state === "on" ? ".nav-feedback" : ".nav-signout button"),
    ).toBeVisible();
    const slots = await measure(page);
    const nav = (await page.locator(".bottom-nav").boundingBox())!;
    expect(Math.round(nav.height)).toBeLessThanOrEqual(49);
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect(slot.box.height).toBeGreaterThanOrEqual(44);
      expect(slot.svg).toEqual({ width: 20, height: 20 });
      expect(slot.overflow).toBeLessThanOrEqual(0);
    }
    expect(slots[3].label).toBe(state === "on" ? "Feedback" : "Sign out");
    // Icon beside the label, not above it.
    const row = await page.evaluate(() => {
      const item = document.querySelector(".bottom-nav a")!;
      return getComputedStyle(item).flexDirection;
    });
    expect(row).toBe("row");
  });
}
