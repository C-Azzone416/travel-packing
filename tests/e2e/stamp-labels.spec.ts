import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { expectAccessible } from "./helpers/a11y";
import { planRouteToList, reviewAndCreate } from "./helpers/plan";
import { planATrip } from "./helpers/menu";

// Per-trip stamp label (#151, #494), through the real data layer. Label editing lives only on the Stamps screen: pick a
// sticker, open Edit stamp label, set a custom label, see it after a reload, and see what a bad label gets.
const NOW = new Date("2026-10-16T12:00:00");

async function openLisbonEditor(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.goto("/stamps");
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Lisbon · Sep 2026" });
  await details.getByRole("button", { name: "Edit stamp label" }).click();
  const sheet = page.getByRole("dialog", { name: "Stamp label" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("set a custom stamp label on the Stamps screen and see it after a reload", async ({
  page,
}) => {
  const sheet = await openLisbonEditor(page);
  await sheet.getByRole("radio", { name: "Custom" }).check();
  const field = sheet.getByRole("textbox", { name: "Label", exact: true });
  await field.fill("sd7");
  await expect(field).toHaveValue("SD7");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Stamp label saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await expect(page.getByRole("article", { name: "Selected trip: Lisbon" })).toContainText("SD7");
});

test("a label that is not exactly 3 letters or numbers is refused with a message, and nothing is saved", async ({
  page,
}) => {
  const sheet = await openLisbonEditor(page);
  await sheet.getByRole("radio", { name: "Custom" }).check();
  const field = sheet.getByRole("textbox", { name: "Label", exact: true });
  await field.fill("ab");
  await field.blur();
  await expect(sheet.getByText("Use exactly 3 letters or numbers (A–Z, 0–9).")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
});

const field = (scope: Locator) => scope.getByRole("textbox", { name: "Label", exact: true });
const save = (sheet: Locator) => sheet.getByRole("button", { name: "Save", exact: true });

async function openAndSave(page: Page, sheet: Locator, text: string) {
  await sheet.getByRole("radio", { name: "Custom" }).check();
  await field(sheet).fill(text);
  await save(sheet).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Stamp label saved.")).toBeVisible();
}

test("Reset to automatic: a saved custom label goes back to the route code after a reload", async ({
  page,
}) => {
  const lisbon = page.getByRole("article", { name: "Selected trip: Lisbon" });
  await openAndSave(page, await openLisbonEditor(page), "sd7");
  await page.reload();
  await expect(lisbon).toContainText("SD7");
  await page.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Lisbon · Sep 2026" })
    .getByRole("button", { name: "Edit stamp label" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Stamp label" });
  await expect(sheet.getByRole("group", { name: "Stamp 1, custom" })).toBeVisible();
  await expect(field(sheet)).toHaveValue("SD7");
  await sheet.getByRole("button", { name: "Reset to automatic" }).click();
  await expect(sheet.getByRole("group", { name: "Stamp 1, automatic" })).toBeVisible();
  await save(sheet).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await expect(lisbon).not.toContainText("SD7");
  await expect(lisbon).toContainText("PRT");
});

test("a two-country trip has two stamps: each slot saves on its own and both persist", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await planATrip(page);
  await planRouteToList(
    page,
    [
      { query: "rome", option: /Rome/ },
      { query: "paris", option: /Paris/ },
    ],
    ["2026-11-12", "2026-11-15", "2026-11-18"],
  );
  await reviewAndCreate(page);
  await page.goto("/stamps");
  const sticker = (place: string) =>
    page.getByRole("button", { name: new RegExp(`^${place}, Nov 2026`) });
  const openSheet = async (place: string) => {
    await sticker(place).click();
    await page
      .getByRole("dialog", { name: new RegExp(`^${place} · Nov 2026`) })
      .getByRole("button", { name: "Edit stamp label" })
      .click();
    const sheet = page.getByRole("dialog", { name: "Stamp label" });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  const slot = (sheet: Locator, n: number) =>
    sheet.getByRole("group", { name: new RegExp(`^Stamp ${n},`) });

  // Slot 1 from the Rome sticker.
  const first = await openSheet("Rome");
  await expect(slot(first, 2).getByText("FRA, the country code for France")).toBeVisible();
  await slot(first, 1).getByRole("radio", { name: "Custom" }).check();
  await field(slot(first, 1)).fill("ab1");
  await save(first).click();
  await expect(first).toBeHidden();
  await page.reload();

  // Slot 2 from the Paris sticker, on its own: slot 1 stays as saved.
  const second = await openSheet("Paris");
  await expect(field(slot(second, 1))).toHaveValue("AB1");
  await slot(second, 2).getByRole("radio", { name: "Custom" }).check();
  await field(slot(second, 2)).fill("zz9");
  await save(second).click();
  await expect(second).toBeHidden();
  await page.reload();
  const rome = await openSheet("Rome");
  await expect(field(slot(rome, 1))).toHaveValue("AB1");
  await expect(field(slot(rome, 2))).toHaveValue("ZZ9");
  await rome.getByRole("button", { name: "Cancel" }).click();
  const again = await openSheet("Paris");
  await expect(field(slot(again, 1))).toHaveValue("AB1");
  await expect(field(slot(again, 2))).toHaveValue("ZZ9");
});

test(
  "the label editor is keyboard operable, accessible and fits a phone",
  DEVICE,
  async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await signInAsOwner(page);
    await page.goto("/stamps");
    const sticker = page.getByRole("button", {
      name: "Lisbon, Sep 2026, inked, 1 trip",
      exact: true,
    });
    await sticker.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    await expect(details).toBeVisible();
    const edit = details.getByRole("button", { name: "Edit stamp label" });
    await edit.focus();
    await page.keyboard.press("Space");
    const sheet = page.getByRole("dialog", { name: "Stamp label" });
    await expect(sheet).toBeVisible();
    await expectAccessible(page, "stamp label editor, automatic", { include: '[role="dialog"]' });
    await sheet.getByRole("radio", { name: "Custom" }).check();
    await field(sheet).fill("a1b");
    await expectAccessible(page, "stamp label editor, custom", { include: '[role="dialog"]' });
    // Tab order inside the dialog: from the field to Save, Cancel and Close, and the trap wraps back to the form.
    const seen: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      await page.keyboard.press("Tab");
      await expect(sheet.locator(":focus")).toHaveCount(1);
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el?.getAttribute("aria-label") || el?.textContent?.trim() || el?.tagName || "";
        }),
      );
    }
    expect(seen.slice(0, 3)).toEqual(["Save", "Cancel", "Close dialog"]);
    for (const name of ["Save", "Close dialog"]) {
      const button = sheet.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // Opening the editor closes the details sheet, so focus goes back to the sticker that opened those.
    await expect(sticker).toBeFocused();
  },
);
