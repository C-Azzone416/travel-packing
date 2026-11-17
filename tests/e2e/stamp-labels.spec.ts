import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

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
