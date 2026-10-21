"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DurableFeedback, OutboxStatus } from "@masra91/framebriar/browser/durable-feedback";
import type { PreparedFeedback } from "@masra91/framebriar/browser/local-export";
import type { AccessStatus, PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import { feedbackBuildSha } from "./build-sha";
import type { reportContext } from "./capture-policy";

export const FEEDBACK_GAME_ID = "travel-packing";

export type ConnectResult = "connected" | "invalid" | "offline" | "uncertain";
export type DisconnectResult = "ended" | "device-only";

/** Reports waiting and blocked on this device (#132), and whether this browser can keep them at all. */
export interface OutboxView {
  waiting: number;
  blocked: number;
  state: "checking" | "available" | "storage-unavailable";
}

/** What saving a reviewed report on this device came to (design's #129 section 4.1). */
export type SaveOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "full" | "unavailable" | "uncertain" | "cancelled" };

export type ReportContext = ReturnType<typeof reportContext>;

export interface FeedbackAccessValue {
  /** Null until the first answer from the access controller (it restores any saved connection first). */
  status: AccessStatus | null;
  outbox: OutboxView;
  connect: (invitation: string) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;
  /** Turns the reviewed notes, screenshot and context into the report to save. Call once per Send; retry a save with the same result. */
  prepareReport: (input: {
    notes: string;
    screenshot: Blob | null;
    context: ReportContext;
  }) => Promise<PreparedFeedback>;
  /** Commits a prepared report to the on-device outbox. Resolves only after the commit; delivery happens later. */
  saveReport: (prepared: PreparedFeedback, signal?: AbortSignal) => Promise<SaveOutcome>;
  /** Called with the id of each report the service has confirmed (Received). Returns the unsubscribe. */
  subscribeReceipts: (listener: (id: string) => void) => () => void;
}

const NO_OUTBOX: OutboxView = { waiting: 0, blocked: 0, state: "checking" };

const NOT_READY: FeedbackAccessValue = {
  status: null,
  outbox: NO_OUTBOX,
  connect: async () => "uncertain",
  disconnect: async () => "device-only",
  prepareReport: async () => {
    throw new Error("Feedback is not ready");
  },
  saveReport: async () => ({ ok: false, reason: "unavailable" }),
  subscribeReceipts: () => () => undefined,
};

const FeedbackAccessContext = createContext<FeedbackAccessValue>(NOT_READY);

export function useFeedbackAccess(): FeedbackAccessValue {
  return useContext(FeedbackAccessContext);
}

/** The SDK is only ever loaded in the browser, after the page is up, so the server render and unit tests never touch it. */
async function loadAccess(): Promise<PlaytestAccess> {
  const { createPlaytestAccess } = await import("@masra91/framebriar/browser/playtest-access");
  return createPlaytestAccess({
    gameId: FEEDBACK_GAME_ID,
    buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
  });
}

/**
 * The durable on-device report outbox, built from the access controller's endpoint and token (#132). Null where this browser has
 * no IndexedDB, so a report can never be claimed saved when it was not. The SDK is loaded here and nowhere on the server.
 */
export type CreateOutbox = (
  access: PlaytestAccess,
  onReceipt: (receipt: { id: string }) => void,
) => Promise<DurableFeedback | null>;

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

export function outboxView(status: OutboxStatus): OutboxView {
  return {
    waiting: status.items,
    blocked: status.blocked ?? 0,
    state: status.state === "storage-unavailable" ? "storage-unavailable" : "available",
  };
}

/** The SDK's storage errors, as the four things the sheet can say. Unknown errors count as unavailable (nothing is claimed saved). */
export function saveFailure(error: unknown): Extract<SaveOutcome, { ok: false }> {
  const named = error as { code?: string; name?: string } | null;
  if (named?.name === "AbortError") return { ok: false, reason: "cancelled" };
  if (named?.code === "storage-full") return { ok: false, reason: "full" };
  if (named?.code === "storage-uncertain" || named?.code === "storage-timeout")
    return { ok: false, reason: "uncertain" };
  return { ok: false, reason: "unavailable" };
}

export function resultAfterFailedConnect(status: AccessStatus, online: boolean): ConnectResult {
  if (status.notice === "connection-uncertain") return "uncertain";
  return online ? "invalid" : "offline";
}

// One access controller for the whole signed-in visit (#131). It restores a saved connection on load, stands down while
// the page is hidden or frozen (pagehide) and picks up again when it returns (pageshow). It never redeems anything by itself.
export function FeedbackAccessProvider({
  children,
  create = loadAccess,
  createOutbox = loadOutbox,
}: {
  children: ReactNode;
  create?: () => Promise<PlaytestAccess>;
  createOutbox?: CreateOutbox;
}) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [outbox, setOutbox] = useState<OutboxView>(NO_OUTBOX);
  const accessRef = useRef<PlaytestAccess | null>(null);
  const outboxRef = useRef<DurableFeedback | null>(null);
  const receipts = useRef(new Set<(id: string) => void>());

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeOutbox: (() => void) | undefined;
    let stop = () => undefined as void;
    let resume = () => undefined as void;
    create()
      .then(async (access) => {
        if (cancelled) {
          access.dispose();
          return;
        }
        accessRef.current = access;
        unsubscribe = access.subscribe(setStatus);
        // The outbox starts on its own: a report saved while offline or disconnected is kept and sent when it can be.
        const box = await createOutbox(access, ({ id }) => {
          for (const listener of receipts.current) listener(id);
        }).catch(() => null);
        if (cancelled) {
          box?.stop();
          access.dispose();
          return;
        }
        outboxRef.current = box;
        if (box) unsubscribeOutbox = box.subscribe((next) => setOutbox(outboxView(next)));
        else setOutbox({ ...NO_OUTBOX, state: "storage-unavailable" });
        stop = () => {
          box?.stop();
          access.stop();
        };
        resume = () => {
          void access.start().catch(() => undefined);
          void box?.start().catch(() => undefined);
        };
        window.addEventListener("pagehide", stop);
        window.addEventListener("pageshow", resume);
        resume();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", resume);
      unsubscribe?.();
      unsubscribeOutbox?.();
      outboxRef.current?.stop();
      outboxRef.current = null;
      accessRef.current?.dispose();
      accessRef.current = null;
    };
  }, [create, createOutbox]);

  // Once connected, whatever is waiting is tried again (the SDK still honours each report's saved retry time).
  const connected = status?.connected === true;
  useEffect(() => {
    if (connected) void outboxRef.current?.resume().catch(() => undefined);
  }, [connected]);

  const connect = useCallback(async (invitation: string): Promise<ConnectResult> => {
    const access = accessRef.current;
    if (!access) return "uncertain";
    const ok = await access.connect(invitation);
    return ok ? "connected" : resultAfterFailedConnect(access.status(), navigator.onLine);
  }, []);

  const disconnect = useCallback(async (): Promise<DisconnectResult> => {
    const access = accessRef.current;
    if (!access) return "device-only";
    const { revoked } = await access.disconnect();
    return revoked === true ? "ended" : "device-only";
  }, []);

  const prepareReport = useCallback<FeedbackAccessValue["prepareReport"]>(
    async ({ notes, screenshot, context }) => {
      const { prepareLocalFeedback } = await import("@masra91/framebriar/browser/local-export");
      return prepareLocalFeedback({ blob: screenshot, captureContext: context, notes });
    },
    [],
  );

  const saveReport = useCallback<FeedbackAccessValue["saveReport"]>(async (prepared, signal) => {
    const box = outboxRef.current;
    if (!box) return { ok: false, reason: "unavailable" };
    try {
      const saved = await box.enqueue({ report: prepared.report, media: prepared.media, signal });
      return { ok: true, id: saved.id };
    } catch (error) {
      return saveFailure(error);
    }
  }, []);

  const subscribeReceipts = useCallback<FeedbackAccessValue["subscribeReceipts"]>((listener) => {
    receipts.current.add(listener);
    return () => receipts.current.delete(listener);
  }, []);

  const value = useMemo<FeedbackAccessValue>(
    () => ({
      status,
      outbox,
      connect,
      disconnect,
      prepareReport,
      saveReport,
      subscribeReceipts,
    }),
    [status, outbox, connect, disconnect, prepareReport, saveReport, subscribeReceipts],
  );
  return <FeedbackAccessContext.Provider value={value}>{children}</FeedbackAccessContext.Provider>;
}
