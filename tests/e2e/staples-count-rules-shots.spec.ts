import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";

const SHOTS = process.env.STAPLES_COUNT_RULES_SHOTS;
const THEMES = ["ocean", "evergreen", "dusk"] as const;
const SIZES = [
  { width: 195, height: 844 },
  { width: 390, height: 844 },
  { width: 1024, height: 1000 },
  { width: 1280, height: 1000 },
] as const;

test.skip(!SHOTS, "set STAPLES_COUNT_RULES_SHOTS=<folder> to render design evidence");

async function shot(page: Page, theme: string, width: number, state: "closed" | "open") {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({
    path: `${SHOTS}/staples-count-rules-${theme}-${width}-${state}.png`,
    fullPage: true,
  });
}

async function expectWholeWords(locator: Locator, label: string) {
  const broken = await locator.evaluate((root) => {
    const words: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
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

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: the document must not overflow horizontally`).toBeLessThanOrEqual(0);
}

for (const theme of THEMES) {
  for (const { width, height } of SIZES) {
    test(`${theme}-${width}: count-rules disclosure evidence`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
      await signInAsOwner(page);
      await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, theme);
      await page.context().addCookies([
        {
          name: "appearance",
          value: theme,
          url: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
        },
      ]);
      await page.goto("/staples");
      await expect(page.getByRole("region", { name: "Clothing" })).toBeVisible();

      const summary = page.getByText("How counts work", { exact: true });
      const disclosure = summary.locator("xpath=ancestor::details");
      await expect(summary).toBeVisible();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expectNoOverflow(page, `${theme} ${width}px closed`);
      await shot(page, theme, width, "closed");

      await summary.click();
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(disclosure.getByText("Fixed per trip", { exact: true })).toBeVisible();
      await expect(disclosure.getByText(/Underwear and socks stay one per day/)).toBeVisible();
      await expectWholeWords(disclosure, `${theme} ${width}px open`);
      await expectNoOverflow(page, `${theme} ${width}px open`);

      const colors = await disclosure.evaluate((root) => {
        const style = getComputedStyle(root);
        const resolve = (value: string) => {
          const probe = document.createElement("span");
          probe.style.color = value;
          root.append(probe);
          const resolved = getComputedStyle(probe).color;
          probe.remove();
          return resolved;
        };
        const summary = root.querySelector("summary")!;
        const label = root.querySelector("strong")!;
        const body = root.querySelector("span")!;
        return {
          summary: getComputedStyle(summary).color,
          summaryToken: resolve(style.getPropertyValue("--link").trim()),
          label: getComputedStyle(label).color,
          labelToken: resolve(style.getPropertyValue("--ink").trim()),
          body: getComputedStyle(body).color,
          bodyToken: resolve(style.getPropertyValue("--muted").trim()),
        };
      });
      expect(colors.summary).toBe(colors.summaryToken);
      expect(colors.label).toBe(colors.labelToken);
      expect(colors.body).toBe(colors.bodyToken);
      await shot(page, theme, width, "open");
    });
  }
}
