import { expect, type Locator, type Page } from "@playwright/test";

/** How far the page's content runs past the viewport's right edge (0 or less: no sideways scroll). */
export const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Every word inside `locator` sits on one line: a word may wrap between words, never inside itself. */
export async function expectWholeWords(locator: Locator, label: string): Promise<void> {
  const broken = await locator.evaluate((root) => {
    const words: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      // Visually hidden text (a 1px clipped box) is read aloud, not seen: it has no lines to break.
      // A cube tile's note is one line cut with an ellipsis by design, never wrapped.
      let hidden = node.parentElement?.closest("[data-note]") != null;
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        const box = el.getBoundingClientRect();
        if (box.width <= 2 && box.height <= 2) hidden = true;
      }
      if (hidden) {
        node = walker.nextNode();
        continue;
      }
      for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const range = document.createRange();
        range.setStart(node, match.index ?? 0);
        range.setEnd(node, (match.index ?? 0) + match[0].length);
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        );
        if (rects.length > 1) words.push(match[0]);
      }
      node = walker.nextNode();
    }
    return words;
  });
  expect(broken, `${label}: words must wrap only at spaces`).toEqual([]);
}
