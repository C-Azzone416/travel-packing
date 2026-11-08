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

/**
 * Large text the way a person with a big text setting gets it: every font size on the page doubled, the rem ones and the
 * pixel-sized rules alike (a root font-size change alone leaves the px rules as they were). Returns the factor actually
 * reached on `sample`, so a test can assert the precondition before it measures anything.
 */
export async function enlargeText(page: Page, sample: Locator, factor = 2): Promise<number> {
  await sample.waitFor();
  return page.evaluate((times) => {
    // No transition may hold a size at its old value while it is read back (WebKit reports the animated value).
    const calm = document.createElement("style");
    calm.textContent =
      "*, *::before, *::after { transition: none !important; animation: none !important; }";
    document.head.append(calm);
    const all = [...document.querySelectorAll<HTMLElement>("main *, header *")];
    // Read every size first, then write: an inheriting child must not be doubled again after its parent was.
    const sizes = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
    all.forEach((el, at) =>
      el.style.setProperty("font-size", `${sizes[at] * times}px`, "important"),
    );
    const now = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
    const ratios = now
      .map((size, at) => size / sizes[at])
      .filter((ratio) => Number.isFinite(ratio));
    ratios.sort((a, b) => a - b);
    // Visually hidden text keeps a fixed size on purpose; the page's own text is what must have doubled.
    return ratios[Math.floor(ratios.length * 0.5)];
  }, factor);
}

/** No two of the panel's leaf rows or tiles overlap each other. */
export async function expectNoOverlap(page: Page, label: string): Promise<void> {
  const clashes = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] li')].filter(
      (li) => li.querySelector("li") === null && li.getBoundingClientRect().width > 0,
    );
    const boxes = leaves.map((li) => ({
      text: (li.textContent ?? "").slice(0, 24),
      r: li.getBoundingClientRect(),
    }));
    const out: string[] = [];
    boxes.forEach((a, i) => {
      boxes.slice(i + 1).forEach((b) => {
        const across = a.r.left < b.r.right - 0.5 && b.r.left < a.r.right - 0.5;
        const down = a.r.top < b.r.bottom - 0.5 && b.r.top < a.r.bottom - 0.5;
        if (across && down) out.push(`${a.text} / ${b.text}`);
      });
    });
    return out;
  });
  expect(clashes, `${label}: rows and tiles must not overlap`).toEqual([]);
}

/** Tabbing through the page keeps every focused control inside the screen sideways, with a visible focus ring. */
export async function expectFocusContained(
  page: Page,
  width: number,
  label: string,
): Promise<void> {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const seen = new Set<string>();
  for (let press = 0; press < 18; press += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const ring = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none";
      return {
        id: `${el.tagName}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 30)}`,
        left: r.left,
        right: r.right,
        ring: ring || shadow,
      };
    });
    if (!state) continue;
    seen.add(state.id);
    expect(state.left, `${label}: ${state.id} starts on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(state.right, `${label}: ${state.id} ends on screen`).toBeLessThanOrEqual(width + 0.5);
    expect(state.ring, `${label}: ${state.id} shows a focus ring`).toBe(true);
  }
  expect(seen.size, `${label}: some controls took focus`).toBeGreaterThan(3);
}

/** Elements that stick out past the viewport's right edge (for a failing overflow assertion's message). */
export function overflowOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter(
        (el) =>
          el.getBoundingClientRect().right > width + 0.5 && el.getBoundingClientRect().width > 0,
      )
      .slice(0, 8)
      .map(
        (el) =>
          `${el.tagName}.${String(el.className).slice(0, 30)} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? "").slice(0, 20)}"`,
      );
  });
}
