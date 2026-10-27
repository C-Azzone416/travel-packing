"use client";

import type { DurableFeedback } from "@masra91/framebriar/browser/durable-feedback";
import type { PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import { feedbackRuntimeEnabled } from "./availability";
import { feedbackBuildSha } from "./build-sha";
import { FEEDBACK_GAME_ID, loadOutbox } from "./outbox";

type ActiveCleanup = () => Promise<void>;

let activeCleanup: ActiveCleanup | null = null;

export interface AccountClosureFeedbackCleanupDependencies {
  enabled: () => boolean;
  createAccess: () => Promise<PlaytestAccess>;
  createOutbox: (access: PlaytestAccess) => Promise<DurableFeedback | null>;
}

const createAccess = async (): Promise<PlaytestAccess> => {
  const { createPlaytestAccess } = await import("@masra91/framebriar/browser/playtest-access");
  return createPlaytestAccess({
    gameId: FEEDBACK_GAME_ID,
    buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
  });
};

const realDependencies: AccountClosureFeedbackCleanupDependencies = {
  enabled: feedbackRuntimeEnabled,
  createAccess,
  createOutbox: (access) => loadOutbox(access, () => undefined),
};

/** Register the controller already serving this browser, so closure can stop delivery before clearing its storage. */
export function registerAccountClosureFeedbackCleanup(cleanup: ActiveCleanup): () => void {
  activeCleanup = cleanup;
  return () => {
    if (activeCleanup === cleanup) activeCleanup = null;
  };
}

/** Privacy-first ordering shared by the mounted controller and the cold-start fallback. */
export async function clearFeedbackResources(
  access: PlaytestAccess,
  outbox: DurableFeedback | null,
): Promise<void> {
  try {
    outbox?.stop();
    await outbox?.clear();
  } finally {
    // disconnect() forgets the browser credential before its best-effort remote revocation request.
    await access.disconnect();
  }
}

/**
 * Remove this browser profile's unsent feedback and enrollment after confirmed account closure. Delivered reports and
 * other browser profiles are outside this browser-only cleanup and must not be described as deleted here.
 */
export async function clearLocalFeedbackAfterAccountClosure(
  dependencies: AccountClosureFeedbackCleanupDependencies = realDependencies,
): Promise<void> {
  if (!dependencies.enabled()) return;

  if (activeCleanup) {
    await activeCleanup();
    return;
  }

  const access = await dependencies.createAccess();
  let outbox: DurableFeedback | null = null;
  try {
    try {
      outbox = await dependencies.createOutbox(access);
      await clearFeedbackResources(access, outbox);
    } catch (error) {
      if (outbox === null) await access.disconnect();
      throw error;
    }
  } finally {
    outbox?.stop();
    access.dispose();
  }
}
