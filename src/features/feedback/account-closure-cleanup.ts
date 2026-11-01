"use client";

import {
  deleteAccountOutbox,
  deleteAllAccountOutboxes,
  deleteLegacyDatabases,
} from "./account-scope";
import { feedbackRuntimeEnabled } from "./availability";

type ActiveCleanup = () => Promise<void>;
type IndexedDbFactory = Pick<IDBFactory, "deleteDatabase"> & Partial<Pick<IDBFactory, "databases">>;

let activeCleanup: ActiveCleanup | null = null;

/**
 * The outbox key of the account whose closure was just submitted. Module state, not browser storage: it survives the in-app redirect
 * to the completion page and is gone on any real page load, in which case closure falls back to clearing every account outbox.
 */
let closingOutbox: string | null = null;

export interface AccountClosureFeedbackCleanupDependencies {
  enabled: () => boolean;
  indexedDB: () => IndexedDbFactory | null;
}

const realDependencies: AccountClosureFeedbackCleanupDependencies = {
  enabled: feedbackRuntimeEnabled,
  indexedDB: () => (typeof indexedDB === "undefined" ? null : indexedDB),
};

/** Register the controller already serving this browser, so closure can stop delivery before clearing its open outbox. */
export function registerAccountClosureFeedbackCleanup(cleanup: ActiveCleanup): () => void {
  activeCleanup = cleanup;
  return () => {
    if (activeCleanup === cleanup) activeCleanup = null;
  };
}

/**
 * Remember WHICH account's outbox is being closed, when the person presses "Close account permanently". The key is the account's
 * opaque outbox key (it names the account AND its generation, never an email or id) and is dropped as soon as the attempt does not
 * end in closure. After confirmed closure only this account's outbox is deleted, so another account's unsent work in this browser
 * is never touched (#261).
 */
export function rememberClosingOutbox(outboxKey: string | null): void {
  closingOutbox = outboxKey;
}

export function forgetClosingOutbox(): void {
  closingOutbox = null;
}

/**
 * Remove this browser profile's unsent feedback after confirmed account closure. The mounted provider clears the open
 * account-scoped queue. When the closing account's outbox key was remembered, ONLY that account's database is deleted, so another
 * account's unsent work in this browser is untouched (#261). When it was not (a direct visit or a reload), the sweep clears every
 * account outbox, which is never fewer than before. Legacy SDK state is always swept. Browser cleanup is best effort: delivered
 * reports and server enrollment revocation remain outside this client hook.
 */
export async function clearLocalFeedbackAfterAccountClosure(
  dependencies: AccountClosureFeedbackCleanupDependencies = realDependencies,
): Promise<void> {
  if (!dependencies.enabled()) return;

  const closing = closingOutbox;
  closingOutbox = null;
  // Capture the function: invoking it can make the provider unregister while the route changes.
  const mounted = activeCleanup;
  await mounted?.().catch(() => undefined);

  const factory = dependencies.indexedDB();
  if (!factory) return;
  if (closing) {
    // A value that is not an outbox key (not something this module stored) throws here: clear everything rather than leave this account's work behind.
    const deleted = await deleteAccountOutbox(factory, closing).then(
      () => true,
      () => false,
    );
    if (!deleted) await deleteAllAccountOutboxes(factory);
  } else {
    await deleteAllAccountOutboxes(factory);
  }
  await deleteLegacyDatabases(factory);
}
