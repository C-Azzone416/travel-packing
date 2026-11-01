import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { chooseFromMenu } from "./helpers/menu";

// #341: a toast must never sit on top of a sheet. While any ModalSheet is open a plain toast is held (clipped from view, timer paused)
// and shows, with its full time, after the sheet closes. Real app and real stylesheet: the clip-path rule only exists here.
// The Undo toast (8s) comes from removing San Diego; the sheet is "Remove Lisbon?" from the Past & archive tab, opened within the
// toast's life. The error banner is not part of the hold and stays visible.
const NOW = new Date("2026-10-16T12:00:00");
const SIZES = [
  [320, 568],
  [390, 844],
  [721, 700],
  [768, 1024],
  [1280, 800],
  [320, 500],
] as const;

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}
const intersects = (a: Box, b: Box) =>
  a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

async function toastThenSheet(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await chooseFromMenu(page, "San Diego", "Remove");
  await page.getByRole("dialog").getByRole("button", { name: "Remove trip" }).click();
  const toast = page.locator(".toast-region .toast");
  await expect(toast).toContainText("San Diego removed");
  await page.getByRole("button", { name: /Past & archive/ }).click();
  await page.getByRole("button", { name: "Remove: Lisbon" }).click();
  await expect(page.getByRole("dialog", { name: "Remove Lisbon?" })).toBeVisible();
  return toast;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, r: r.right, b: r.bottom };
    };
    const region = document.querySelector(".toast-region") as HTMLElement;
    const toast = document.querySelector(".toast-region .toast") as HTMLElement;
    const buttons = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')];
    return {
      clipPath: getComputedStyle(region).clipPath,
      pointerEvents: getComputedStyle(region).pointerEvents,
      toast: box(toast),
      buttons: buttons.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { text: el.textContent ?? "", box: box(el), onTop: hit === el || el.contains(hit) };
      }),
    };
  });
}

for (const [width, height] of SIZES) {
  test(
    `a toast is held behind a sheet, then shown and dismissed on its timer at ${width}x${height}`,
    DEVICE,
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      const toast = await toastThenSheet(page);

      const open = await geometry(page);
      expect(open.clipPath, "the held toast is clipped from view").not.toBe("none");
      expect(open.pointerEvents).toBe("none");
      for (const button of open.buttons) {
        expect(button.onTop, `${button.text} is the top element`).toBe(true);
        // A toast that is not clipped would be a visible one: it must not touch any sheet button.
        if (open.clipPath === "none")
          expect(intersects(open.toast, button.box), `toast covers ${button.text}`).toBe(false);
      }
      // Held, not dropped: still in the page (and the accessibility tree) for a screen reader.
      await expect(toast).toHaveCount(1);
      expect(await page.evaluate(() => document.body.hasAttribute("data-sheet-open"))).toBe(true);

      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => document.body.hasAttribute("data-sheet-open"))).toBe(false);
      await expect(toast).toBeVisible();
      const shown = await page.evaluate(
        () => getComputedStyle(document.querySelector(".toast-region") as HTMLElement).clipPath,
      );
      expect(shown, "the toast is back in view after the sheet closes").toBe("none");
      // It is then dismissed on its own timer (8s with an action). A pointer left where the toast came back would pause it (hover),
      // as it should, so move the pointer away first.
      await page.mouse.move(0, 0);
      await expect(toast).toHaveCount(0, { timeout: 15_000 });
    },
  );
}

test("the error banner stays visible with a sheet open", DEVICE, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await toastThenSheet(page);
  // Nothing in the app raises the assertive banner yet, so put one in its region the way the provider renders it.
  await page.evaluate(() => {
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.textContent = "Couldn’t save";
    document.querySelector(".error-region")?.append(banner);
  });
  const banner = page.locator(".error-region .error-banner");
  await expect(banner).toBeVisible();
  const clip = await page.evaluate(
    () => getComputedStyle(document.querySelector(".error-region") as HTMLElement).clipPath,
  );
  expect(clip).toBe("none");
  const { bannerBox, buttons } = await page.evaluate(() => {
    const r = document.querySelector(".error-region")!.getBoundingClientRect();
    return {
      bannerBox: { x: r.x, y: r.y, r: r.right, b: r.bottom },
      buttons: [...document.querySelectorAll('[role="dialog"] button')].map((el) => {
        const q = el.getBoundingClientRect();
        return { x: q.x, y: q.y, r: q.right, b: q.bottom };
      }),
    };
  });
  for (const button of buttons) expect(intersects(bannerBox, button)).toBe(false);
});
