"use client";

import { deleteAllAccountOutboxes, deleteLegacyDatabases } from "./account-scope";
import { feedbackRuntimeEnabled } from "./availability";

type ActiveCleanup = () => Promise<void>;
type IndexedDbFactory = Pick<IDBFactory, "deleteDatabase"> & Partial<Pick<IDBFactory, "databases">>;

let activeCleanup: ActiveCleanup | null = null;

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
 * Remove this browser profile's unsent feedback after confirmed account closure. The mounted provider clears the open
 * account-scoped queue; the sweep covers a completion-page reload and old browser-held SDK state. Browser cleanup is best effort:
 * delivered reports and server enrollment revocation remain outside this client hook.
 */
export async function clearLocalFeedbackAfterAccountClosure(
  dependencies: AccountClosureFeedbackCleanupDependencies = realDependencies,
): Promise<void> {
  if (!dependencies.enabled()) return;

  // Capture the function: invoking it can make the provider unregister while the route changes.
  const mounted = activeCleanup;
  await mounted?.().catch(() => undefined);

  const factory = dependencies.indexedDB();
  if (!factory) return;
  await deleteAllAccountOutboxes(factory);
  await deleteLegacyDatabases(factory);
}
