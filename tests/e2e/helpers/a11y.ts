import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

// Accessibility checks for #21: axe-core against WCAG 2.2 AA (and the A levels below it) on the page as it is right
// now. The spec fails on ANY violation, not only serious or critical ones, so a regression is caught at its first
// appearance. A violation prints its rule, how many nodes, and the first selectors, never page text.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

export interface A11yOptions {
  /** Narrow the check to part of the page, for example an open dialog. */
  include?: string;
  /** Rules turned off for this state, each with the reason in the calling spec. */
  disable?: string[];
}

export async function expectAccessible(page: Page, label: string, options: A11yOptions = {}) {
  // The title streams in with the page; checking before it arrives reports a missing <title> that is not a real problem
  // (it failed once in CI on a screen reached by a redirect).
  await expect(page).toHaveTitle(/.+/);
  // Animations would make contrast depend on the instant of the check.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // WebKit keeps a dialog's fade-in running after the media change (Chromium has finished it by now), and axe then reads
  // blended text over the backdrop (contrast 1.5-1.9). Jump every finite animation to its end instead of waiting for real time:
  // that is deterministic, and it cannot hang on an animation that is paused or very long (one did, on the Ready review).
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations === Infinity) continue;
      try {
        animation.finish();
      } catch {
        // not finishable (for example an infinite duration): leave it, axe measures it as it is
      }
    }
  });
  const analyze = async (include?: string) => {
    let builder = new AxeBuilder({ page }).withTags(TAGS);
    if (include) builder = builder.include(include);
    if (options.disable?.length) builder = builder.disableRules(options.disable);
    return (await builder.analyze()).violations;
  };
  let violations = await analyze(options.include);

  // A real phone is short (iPhone 15: 659px). Content below the fold of a scrolling sheet is read by axe as not visible, which
  // turns a perfectly labelled switch into "form element has no visible label". So each flagged element is scrolled into view
  // and checked again on its own; only what still fails is reported. A genuine violation fails in both passes.
  if (violations.length > 0) {
    const flagged = new Map<string, Set<string>>();
    for (const violation of violations)
      for (const node of violation.nodes) {
        const target = String(node.target[0]);
        flagged.set(target, (flagged.get(target) ?? new Set()).add(violation.id));
      }
    const confirmed = new Set<string>();
    for (const [target, rules] of flagged) {
      await page
        .locator(target)
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
      for (const again of await analyze(target))
        if (rules.has(again.id)) confirmed.add(`${again.id}\u0000${target}`);
    }
    violations = violations
      .map((violation) => ({
        ...violation,
        nodes: violation.nodes.filter((node) =>
          confirmed.has(`${violation.id}\u0000${String(node.target[0])}`),
        ),
      }))
      .filter((violation) => violation.nodes.length > 0);
  }
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    where: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    help: violation.help,
  }));
  expect(summary, `axe violations: ${label}`).toEqual([]);
}

/**
 * A dialog's keyboard behaviour (#21): it opens from the keyboard, Tab and Shift+Tab stay inside it however many times they
 * are pressed, Escape closes it, and focus goes back to what opened it. The page behind it is checked by ModalSheet's own
 * tests (inert); this is the end-to-end proof, for each dialog a screen adds.
 */
export async function expectDialogKeyboard(page: Page, opener: Locator, dialog: Locator) {
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const inside = () => dialog.evaluate((node) => node.contains(document.activeElement));
  for (let press = 0; press < 14; press += 1) {
    await page.keyboard.press("Tab");
    expect(await inside(), `Tab ${press + 1} stays in the dialog`).toBe(true);
  }
  for (let press = 0; press < 14; press += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside(), `Shift+Tab ${press + 1} stays in the dialog`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}
