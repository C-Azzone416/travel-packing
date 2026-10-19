import { expect, test, type Page } from "@playwright/test";
import { resetOwnerData } from "./database";

// Synthetic values for the e2e-only fake sign-in (never available on Vercel; see src/server/auth/e2e-provider.ts).
export const E2E_PASSWORD = "synthetic-e2e-only";
export const OWNER_EMAIL = "owner@example.test";
export const OTHER_EMAIL = "intruder@example.test";
/** Allowlisted like the owners but never seeded: a second real user with nothing of their own (cross-user tests). */
export const SECOND_EMAIL = "second@example.test";

export const PROJECT_NAMES = ["phone", "desktop"] as const;

/**
 * Each Playwright project signs in as its own seeded owner, so the phone and desktop runs (which execute in parallel
 * against one database) never change each other's trips.
 */
export const ownerEmailFor = (project: string) => `owner-${project}@example.test`;

/**
 * One person per project who signs UP during the test (#27). Allowlisted so the code can succeed, never seeded, and
 * reset at the start of every test (tests/e2e/helpers/inbox.ts) so each run begins with no account.
 */
export const NEWCOMER_POOL = 40;
/** A different newcomer per test (the 30-second gap and hourly cap are per address), cycling through an allowlisted pool. */
export const newcomerEmailFor = (project: string, slot: number) =>
  `newcomer-${project}-${slot % NEWCOMER_POOL}@example.test`;
/** Never allowlisted: the sign-up, code and reset screens must treat this address exactly like an allowed one. */
export const STRANGER_EMAIL = "stranger@example.test";

/** Everyone the e2e server allowlists: the shared owner, one owner per project, the second (unseeded) user, and the newcomers. */
export const ALLOWLISTED_EMAILS = [
  OWNER_EMAIL,
  ...PROJECT_NAMES.map(ownerEmailFor),
  SECOND_EMAIL,
  ...PROJECT_NAMES.flatMap((project) =>
    Array.from({ length: NEWCOMER_POOL }, (_, slot) => newcomerEmailFor(project, slot)),
  ),
];

/** The owners whose sample trips are seeded, by the user id the fake sign-in produces ("e2e-" + email). */
export const SEEDED_OWNER_IDS = [OWNER_EMAIL, ...PROJECT_NAMES.map(ownerEmailFor)].map(
  (email) => `e2e-${email}`,
);

export async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in as this project's seeded owner (reset to the seeded state first) and wait until the app is showing. */
export async function signInAsOwner(page: Page, email = ownerEmailFor(test.info().project.name)) {
  // Every test starts from the freshly seeded state, whatever earlier tests created or changed.
  const ownerId = `e2e-${email}`;
  if (SEEDED_OWNER_IDS.includes(ownerId)) await resetOwnerData(ownerId);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/$/);
}
