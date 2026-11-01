import { expect, type Page } from "@playwright/test";

// Shared by the narrow-width specs (#332). SCREENSHOTS=<folder> saves a picture of each page and state for design review
// (unset in CI).
const SHOTS = process.env.SCREENSHOTS;

export interface Facts {
  /** Short words (up to 14 letters) that wrap inside the word, e.g. "Bathroo/m": only measured under 240px. */
  broken: string[];
  scroll: number;
  offenders: string[];
}

/** Sideways scroll of the page, plus the deepest visible elements outside the viewport that no in-view ancestor clips. */
export async function measure(page: Page): Promise<Facts> {
  // A page that redirects on the client (/verify without a pending sign-up) destroys the context once: settle, then measure.
  await page.waitForLoadState("load");
  const run = () =>
    page.evaluate(() => {
      scrollTo(0, scrollY); // a focused field can have scrolled the page sideways; measure from the left edge
      const width = document.documentElement.clientWidth;
      const out: Element[] = [];
      const clips = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.overflowX !== "visible" ||
          style.clipPath !== "none" ||
          style.clip !== "auto" ||
          style.display === "contents"
        );
      };
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (rect.width <= 1 || rect.height <= 1) continue;
        if (rect.bottom <= 0) continue; // parked above the page (the skip link until it is focused)
        if (rect.right <= width + 1 && rect.left >= -1) continue;
        if (style.clip !== "auto") continue; // the visually-hidden pattern
        let clipped = false;
        for (
          let up = el.parentElement;
          up && up !== document.documentElement;
          up = up.parentElement
        ) {
          if (!clips(up)) continue;
          const box = up.getBoundingClientRect();
          if (box.right <= width + 1 && box.left >= -1) {
            clipped = true;
            break;
          }
        }
        if (!clipped) out.push(el);
      }
      const broken: string[] = [];
      if (width < 240) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (
          let node = walker.nextNode() as Text | null;
          node;
          node = walker.nextNode() as Text | null
        ) {
          const parent = node.parentElement;
          if (!parent || parent.closest(".bottom-nav, script, style, [aria-hidden='true'] svg"))
            continue;
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || style.clip !== "auto")
            continue;
          const box = parent.getBoundingClientRect();
          if (box.width <= 1 || box.height <= 1) continue;
          for (const match of node.data.matchAll(
            /(?<=^|\s)[\p{L}\p{N}°]{3,14}(?=[\s.,:;!?)·]|$)/gu,
          )) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const tops = new Set(
              Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
            );
            if (tops.size > 1) {
              // Only a word that would have fitted on a line of its own counts: a longer one has to break somewhere.
              const natural = Array.from(range.getClientRects()).reduce(
                (sum, rect) => sum + rect.width,
                0,
              );
              let block: Element = parent;
              while (block.parentElement && getComputedStyle(block).display.startsWith("inline"))
                block = block.parentElement;
              const blockStyle = getComputedStyle(block);
              const room =
                block.clientWidth -
                parseFloat(blockStyle.paddingLeft) -
                parseFloat(blockStyle.paddingRight);
              if (natural <= room + 1)
                broken.push(
                  `"${match[0]}" in ${parent.tagName.toLowerCase()}.${String(parent.getAttribute("class") ?? "").split(" ")[0]}`,
                );
            }
          }
        }
      }
      const scroll = document.documentElement.scrollWidth - width;
      if (scroll > 0 && out.length === 0) {
        // Something makes the page scroll but is not "visible and outside" by the rules above (zero-size, clipped...): name it.
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          if (getComputedStyle(el).display === "none") continue;
          const style = getComputedStyle(el);
          const spills =
            el.clientWidth > 0 &&
            el.scrollWidth > el.clientWidth + 1 &&
            style.overflowX === "visible";
          if (el.getBoundingClientRect().right > width + 1 || spills) out.push(el);
        }
      }
      const deepest = out.filter((el) => !out.some((other) => other !== el && el.contains(other)));
      return {
        scroll,
        broken: broken.slice(0, 12),
        offenders: deepest.slice(0, 8).map((el) => {
          const name = (node: Element) =>
            `${node.tagName.toLowerCase()}.${String(node.getAttribute("class") ?? "").split(" ")[0]}`;
          const rect = el.getBoundingClientRect();
          const chain: string[] = [];
          for (let up = el.parentElement; up && chain.length < 4; up = up.parentElement) {
            chain.push(`${name(up)}(${Math.round(up.getBoundingClientRect().width)})`);
          }
          const text = (el.textContent ?? "").trim().slice(0, 24);
          return `${name(el)} "${text}" [${Math.round(rect.left)}..${Math.round(rect.right)}] of ${width} in ${chain.join(" < ")}`;
        }),
      };
    });
  try {
    return await run();
  } catch (error) {
    if (!String(error).includes("Execution context was destroyed")) throw error;
    await page.waitForLoadState("load");
    return run();
  }
}

export async function expectFits(page: Page, label: string, shot?: string) {
  if (SHOTS && shot) {
    await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
  const facts = await measure(page);
  expect.soft(facts.scroll, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect.soft(facts.broken, `${label}: words broken inside the word`).toEqual([]);
  expect.soft(facts.offenders, `${label}: elements outside the viewport`).toEqual([]);
}
