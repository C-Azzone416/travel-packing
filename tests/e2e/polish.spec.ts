import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// Layout polish (#160): small layout facts that only a rendered page can show.
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
  "Staples on a phone: the suitcase fills the page, the add field and button share a row, cube counts stay on one line",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staples");
    await expect(page.getByRole("heading", { name: "Clothing", level: 2 })).toBeVisible();
    const title = await page.getByRole("heading", { name: "Staples", level: 1 }).boundingBox();
    const cube = await page.getByRole("heading", { name: "Clothing", level: 2 }).boundingBox();
    // The cube cards sit inside the suitcase rim, inside the page gutter.
    expect(cube!.x).toBeGreaterThan(title!.x);
    const field = await page.getByRole("textbox", { name: "Staple name" }).boundingBox();
    const add = await page.getByRole("button", { name: "Add staple" }).boundingBox();
    expect(Math.abs(field!.y + field!.height / 2 - (add!.y + add!.height / 2))).toBeLessThanOrEqual(
      2,
    );
    expect(add!.x).toBeGreaterThan(field!.x + field!.width - 1);
    const count = await page
      .getByRole("region", { name: "Clothing" })
      .getByText(/^\d+ staples?$/)
      .boundingBox();
    expect(count!.height).toBeLessThan(24);
  },
);

test("Staples: a group's count shares the heading's row", async ({ page }) => {
  await page.goto("/staples");
  const head = await page.getByRole("heading", { name: "Clothing", level: 2 }).boundingBox();
  const count = await page
    .getByRole("region", { name: "Clothing" })
    .getByText(/^\d+ staples?$/)
    .boundingBox();
  // The count's box sits within the heading's row, not above or below it.
  expect(count!.y).toBeGreaterThanOrEqual(head!.y - 2);
  expect(count!.y + count!.height).toBeLessThanOrEqual(head!.y + head!.height + 2);
});
