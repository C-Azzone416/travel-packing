import { expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "../../../src/server/db/retention";
import * as schema from "../../../src/server/db/schema";
import { signInAsOwner } from "./auth";
import { E2E_DATABASE_URL } from "./database";
import { FAKE_FRAMEBRIAR_PORT } from "../support/ports";

// Shared steps for the feedback specs (#131-#133, #260). They drive the real app, its real server routes and the real SDK outbox; only
// Framebriar itself is the fake, a small process the app's SERVER talks to (tests/e2e/support/fake-framebriar-server.ts), steered here.
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" });

const CONTROL = `http://127.0.0.1:${FAKE_FRAMEBRIAR_PORT}/__control`;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CONTROL}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`fake Framebriar control ${path} failed`);
  return (await response.json()) as T;
}

export type FakeRoute = "redeem" | "refresh" | "disconnect" | "report" | "media";
export type FakeFailure =
  | { kind: "status"; status: 401 | 403 | 404 | 409 | 429 | 500 | 503; retryAfterSeconds?: number }
  | { kind: "network" }
  | { kind: "malformed" };

/** What the fake service received. Synthetic data only; never a token or an invitation. */
export interface DeliveredReport {
  report: { id: string; notes: string; scene: string; gameId: string };
  mediaBytes: number | null;
}

export const fakeFramebriar = {
  /** A clean service for one test: no invitations, enrollments, reports, queued failures or custom lifetime. */
  reset: () => call<{ ok: true }>("reset", {}),
  issueInvitation: async () => (await call<{ invitation: string }>("invite", {})).invitation,
  failNext: (route: FakeRoute, failure: FakeFailure, times = 1) =>
    call<{ ok: true }>("fail-next", { route, failure, times }),
  /** The owner revokes every enrollment at Framebriar. The app learns of it the next time it talks to Framebriar. */
  revokeAll: () => call<{ ok: true }>("revoke-all", {}),
  /** The service is unreachable (the app's server gets a network failure) until turned back on. */
  setOffline: (offline: boolean) => call<{ ok: true }>("offline", { offline }),
  /** How long enrollments created from now on last. */
  setEnrollmentMs: (ms: number) => call<{ ok: true }>("enrollment-ms", { ms }),
  counts: () => call<Record<FakeRoute, number>>("counts"),
  delivered: () => call<DeliveredReport[]>("delivered"),
};

/** The server-held enrollment and any unfinished redemption for one account, so a spec can start from "never connected". */
export async function forgetFeedbackEnrollment(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .delete(schema.framebriarEnrollments)
      .where(eq(schema.framebriarEnrollments.ownerId, ownerId));
    await db
      .delete(schema.framebriarRedemptions)
      .where(eq(schema.framebriarRedemptions.ownerId, ownerId));
  } finally {
    await pool.end();
  }
}

export async function openSettings(page: Page) {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await nav(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Send feedback to the developer" })).toBeVisible();
}

export async function goToTrips(page: Page) {
  await nav(page).getByRole("link", { name: "Trips" }).click();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
}

/** Pastes an invitation (a fresh one unless given) on Settings and waits for Connected. */
export async function connectFeedback(page: Page, invitation?: string) {
  await page.getByLabel("Invitation").fill(invitation ?? (await fakeFramebriar.issueInvitation()));
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator(".status-pill", { hasText: "Connected" })).toBeVisible();
}

/** Signed in, connected through Settings, and back on the trips screen with the Feedback button on. */
export async function connectedOnTrips(page: Page) {
  await openSettings(page);
  await connectFeedback(page);
  await goToTrips(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();
}

export async function openSettingsFromNav(page: Page) {
  await nav(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Send feedback to the developer" })).toBeVisible();
}

/** The "Sign out" item in the main navigation. */
export async function signOut(page: Page) {
  await nav(page).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

/** The names of the feedback databases this browser holds for accounts (the outbox is one database per account). */
export const accountOutboxDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name ?? "")
      .filter((name) => name.startsWith("framebriar-v1-acct-")),
  );
