import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

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
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (options.include) builder = builder.include(options.include);
  if (options.disable?.length) builder = builder.disableRules(options.disable);
  const { violations } = await builder.analyze();
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    where: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    help: violation.help,
  }));
  expect(summary, `axe violations: ${label}`).toEqual([]);
}
