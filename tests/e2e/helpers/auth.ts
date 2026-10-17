import { expect, type Page } from "@playwright/test";

// Synthetic values for the e2e-only fake sign-in (never available on Vercel; see src/server/auth/e2e-provider.ts).
export const E2E_PASSWORD = "synthetic-e2e-only";
export const OWNER_EMAIL = "owner@example.test";
export const OTHER_EMAIL = "intruder@example.test";

export async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in as the allowlisted owner and wait until the app is showing. */
export async function signInAsOwner(page: Page) {
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/$/);
}
