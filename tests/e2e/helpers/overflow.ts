import { expect, type Page } from "@playwright/test";

// Shared by the narrow-width specs (#332). SCREENSHOTS=<folder> saves a picture of each page and state for design review
// (unset in CI).
const SHOTS = process.env.SCREENSHOTS;

export interface Facts {
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
  expect.soft(facts.offenders, `${label}: elements outside the viewport`).toEqual([]);
}
