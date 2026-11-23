import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

const STICKER = "San Diego, Oct 2026, upcoming, not inked yet";

test(
  "first observed trusted activation opens one owned details entry (#572)",
  DEVICE,
  async ({ page }, info) => {
    await page.setViewportSize({ width: info.project.name === "phone" ? 390 : 1440, height: 844 });
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    await signInAsOwner(page);
    await page.addInitScript((name) => {
      const events: unknown[] = [];
      Object.assign(window, { stampsReadinessEvents: events });
      const observer = new MutationObserver(() => {
        if (!document.querySelector(`button[aria-label="${name}"]`)) return;
        events.push({ event: "sticker-observed", time: performance.now() });
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
      document.addEventListener(
        "click",
        (event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(`button[aria-label="${name}"]`)
          )
            return;
          events.push({
            event: "click",
            trusted: event.isTrusted,
            time: performance.now(),
            length: history.length,
            state: history.state,
          });
        },
        true,
      );
    }, STICKER);
    await page.goto("/stamps", { waitUntil: "commit" });
    // This is the first action requested after navigation commits; Playwright waits only for native actionability.
    const sticker = page.getByRole("button", { name: STICKER, exact: true });
    await sticker.click();
    await expect(
      page.getByRole("dialog", { name: "San Diego · Oct 2026", exact: true }),
    ).toBeVisible();
    const evidence = await page.evaluate(() => ({
      events: (
        window as unknown as {
          stampsReadinessEvents: { event: string; trusted?: boolean; length?: number }[];
        }
      ).stampsReadinessEvents,
      state: history.state,
      length: history.length,
    }));
    const clicks = evidence.events.filter((event) => event.event === "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].trusted).toBe(true);
    expect(evidence.length).toBe(clicks[0].length! + 1);
    expect(evidence.state.packingStampDetails).toEqual({
      owner: expect.any(String),
      key: expect.any(String),
    });
    await info.attach("earliest-observed-activation", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: `test-results/screenshots/stamps-ready-${info.project.name}-details.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(sticker).toBeFocused();
    await expect(sticker).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: `test-results/screenshots/stamps-ready-${info.project.name}-after-back.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goForward();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  },
);

test(
  "native Forward during label handoff preserves the editor draft (#572)",
  DEVICE,
  async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    await signInAsOwner(page);
    await page.goto("/stamps", { waitUntil: "commit" });
    await page.getByRole("button", { name: STICKER, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Edit stamp label", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "Stamp label", exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole("radio", { name: "Custom", exact: true }).first().check();
    const input = editor.getByRole("textbox", { name: "Label", exact: true }).first();
    await input.fill("QAZ");
    expect(await page.evaluate(() => history.state.packingStampDetails)).toBeUndefined();
    await page.goForward();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(editor).toBeVisible();
    await expect(input).toHaveValue("QAZ");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goForward();
    await expect(
      page.getByRole("dialog", { name: "San Diego · Oct 2026", exact: true }),
    ).toBeVisible();
  },
);
