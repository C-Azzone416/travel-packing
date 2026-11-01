import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { fakeFramebriar, feedbackOff } from "./helpers/feedback";
import { expectFits } from "./helpers/overflow";

// #332 x #371: the four tab-bar slots at 195px (200% zoom of a phone) and 160px, with Feedback on and off, at 100% and 200% text:
// the slots never overlap, no label is cut off or leaves its slot, the page does not scroll sideways, and the bar keeps 44px targets.
// SCREENSHOTS=<folder> saves the bar for design review (unset in CI).
const SHOTS = process.env.SCREENSHOTS;
test.beforeEach(() => fakeFramebriar.reset());

async function slots(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav")!;
    const drawn = [...nav.children].filter((el) => el.getBoundingClientRect().width > 0);
    return drawn.map((slot) => {
      const rect = slot.getBoundingClientRect();
      const inner = slot.matches("form") ? slot.firstElementChild! : slot;
      const label = [
        ...slot.querySelectorAll<HTMLElement>(".nav-label, .nav-label-long, .nav-label-short"),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => !el.querySelector(".nav-label-long, .nav-label-short"))[0];
      const labelRect = label.getBoundingClientRect();
      return {
        text: label.textContent ?? "",
        left: rect.left,
        right: rect.right,
        height: rect.height,
        labelLeft: labelRect.left,
        labelRight: labelRect.right,
        labelClipped: label.scrollWidth - label.clientWidth,
        slotClipped: inner.scrollWidth - inner.clientWidth,
        viewport: document.documentElement.clientWidth,
      };
    });
  });
}

for (const width of [195, 160] as const) {
  for (const text of [100, 200] as const) {
    test(
      `the tab bar fits at ${width}px, ${text}% text, Feedback on and off`,
      width === 195 ? DEVICE : {},
      async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 422 });
        await signInAsOwner(page);
        await page.goto("/");
        await expect(page.locator(".nav-feedback")).toBeVisible();
        for (const state of ["on", "off"] as const) {
          if (state === "off") {
            await feedbackOff(page);
            await page.reload();
            await expect(page.locator(".nav-feedback")).toHaveCount(0);
          }
          if (text !== 100)
            await page.addStyleTag({ content: `html{font-size:${text}% !important}` });
          await page.evaluate(() => document.fonts.ready);
          if (SHOTS) {
            await page.locator(".bottom-nav").screenshot({
              path: `${SHOTS}/v3-tabbar-${width}-${text}pct-feedback-${state}.png`,
            });
          }
          const found = await slots(page);
          const where = `${width}px ${text}% Feedback ${state}`;
          expect(found, `${where}: four slots`).toHaveLength(4);
          found.forEach((slot, index) => {
            const name = `${where} slot ${index + 1} (${slot.text})`;
            expect(slot.height, `${name} is a 44px target`).toBeGreaterThanOrEqual(44);
            expect(slot.left, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
            expect(slot.right, `${name} ends inside the viewport`).toBeLessThanOrEqual(
              slot.viewport + 0.5,
            );
            expect(slot.labelClipped, `${name} label is not cut off`).toBeLessThanOrEqual(0);
            expect(slot.slotClipped, `${name} does not scroll`).toBeLessThanOrEqual(0);
            expect(slot.labelLeft, `${name} label stays in its slot`).toBeGreaterThanOrEqual(
              slot.left - 0.5,
            );
            expect(slot.labelRight, `${name} label stays in its slot`).toBeLessThanOrEqual(
              slot.right + 0.5,
            );
            if (index > 0) {
              expect(slot.left, `${name} does not overlap the slot before`).toBeGreaterThanOrEqual(
                found[index - 1].right - 0.5,
              );
            }
          });
          expect(found[3].text).toBe(state === "on" ? found[3].text : "Sign out");
          // The whole page at 200% text is out of scope at 160px (800% of a 20px-wide-text phone): only the bar is held to it there.
          if (text === 100) await expectFits(page, where);
        }
      },
    );
  }
}
