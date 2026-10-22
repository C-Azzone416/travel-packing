import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Field Ledger polish (#160): small layout facts that only a rendered page can show.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
  await signInAsOwner(page);
});

test("create: the empty Destination search uses the normal control border until there is text", async ({
  page,
}) => {
  await page.goto("/trips/new");
  const search = page.getByRole("combobox", { name: "Destination search" });
  // Resolved colours of the tokens, so the test follows the theme instead of hard-coding a value.
  const token = (name: string) =>
    page.evaluate((variable) => {
      const probe = document.createElement("div");
      probe.style.borderTop = `1px solid var(${variable})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return colour;
    }, name);
  const border = () =>
    search.evaluate((node) => {
      const style = getComputedStyle(node);
      return { colour: style.borderTopColor, width: style.borderTopWidth, shadow: style.boxShadow };
    });
  await expect(search).toHaveAttribute("aria-invalid", "true");
  expect(await border()).toEqual({
    colour: await token("--line-strong"),
    width: "1px",
    shadow: "none",
  });
  // Once something is typed that is not yet a confirmed place, the warning style returns.
  await search.fill("Lis");
  await search.blur();
  expect((await border()).colour).toBe(await token("--warn"));
});

test(
  "Staples on a phone: groups line up with the page, + Add sits under the lede, counts stay on one line",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staples");
    const title = await page
      .getByRole("heading", { name: "Every trip starts here", level: 1 })
      .boundingBox();
    const group = await page.getByRole("heading", { name: "Clothing", level: 2 }).boundingBox();
    expect(Math.abs(group!.x - title!.x)).toBeLessThanOrEqual(1);
    const lede = await page.getByText(/Clothing, bathroom, tech/).boundingBox();
    const add = await page.getByRole("button", { name: /Add$/ }).first().boundingBox();
    expect(add!.y).toBeGreaterThanOrEqual(lede!.y + lede!.height);
    expect(lede!.width).toBeGreaterThan(300);
    const count = await page.locator(".category-count").first().boundingBox();
    expect(count!.height).toBeLessThan(24);
  },
);

test("Staples: a group's count shares the heading's row", async ({ page }) => {
  await page.goto("/staples");
  const head = await page.getByRole("heading", { name: "Clothing", level: 2 }).boundingBox();
  const count = await page.locator(".category-count").first().boundingBox();
  // The count's box sits within the heading's row, not above or below it.
  expect(count!.y).toBeGreaterThanOrEqual(head!.y - 2);
  expect(count!.y + count!.height).toBeLessThanOrEqual(head!.y + head!.height + 2);
});

test("packing: the back link leaves a visible space between the arrow and its text", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 1 })).toBeVisible();
  const gap = await page.evaluate(() => {
    const link = document.querySelector(".back-link") as HTMLElement;
    const arrow = link.querySelector("span") as HTMLElement;
    const text = [...link.childNodes].find(
      (node) => node.nodeType === 3 && (node.textContent ?? "").trim(),
    ) as Text;
    const range = document.createRange();
    const start = (text.textContent ?? "").search(/\S/);
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    return range.getBoundingClientRect().left - arrow.getBoundingClientRect().right;
  });
  expect(gap).toBeGreaterThanOrEqual(4);
});
