"use client";

import type { DurableFeedback } from "@masra91/framebriar/browser/durable-feedback";
import type { PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import { feedbackBuildSha } from "./build-sha";

export const FEEDBACK_GAME_ID = "travel-packing";

export type CreateOutbox = (
  access: PlaytestAccess,
  onReceipt: (receipt: { id: string }) => void,
) => Promise<DurableFeedback | null>;

/** Open the durable on-device report outbox for this app's one service/game scope. */
export const loadOutbox: CreateOutbox = async (access, onReceipt) => {
  if (typeof indexedDB === "undefined") return null;
  const { createDurableFeedback } = await import("@masra91/framebriar/browser/durable-feedback");
  return createDurableFeedback({
    gameId: FEEDBACK_GAME_ID,
    buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
    endpoint: access.endpoint,
    getToken: () => access.getToken(),
    onReceipt,
  });
};
