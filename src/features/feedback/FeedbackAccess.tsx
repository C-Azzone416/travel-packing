"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { DurableFeedback, OutboxStatus } from "@masra91/framebriar/browser/durable-feedback";
import type { PreparedFeedback } from "@masra91/framebriar/browser/local-export";
import {
  accountScope,
  deleteAccountOutbox,
  deleteLegacyDatabases,
  sweepOtherAccounts,
} from "./account-scope";
import { feedbackE2eBuild, feedbackRuntimeEnabled, PREVIEW_FEEDBACK_ORIGIN } from "./availability";
import { feedbackBuildSha } from "./build-sha";
import { registerAccountClosureFeedbackCleanup } from "./account-closure-cleanup";
import type { reportContext } from "./capture-policy";
import { createProxySend, REPORTS_PATH } from "./delivery";
import {
  disconnectEnrollment,
  readEnrollment,
  redeemInvitation,
  type DisconnectFailure,
  type DisconnectOutcome,
  type EnrollmentView,
} from "./enrollment-client";
import { feedbackStatus, type FeedbackStatus } from "./status";

export const FEEDBACK_GAME_ID = "travel-packing";

/** What pressing Connect came to. Each one is something the Settings section can say truthfully; none is retried by the app. */
export type ConnectResult =
  | { kind: "connected" }
  | { kind: "invalid" }
  /** The invitation may be spent. Pasting the same one again finishes the connection without spending it twice. */
  | { kind: "uncertain" }
  | { kind: "offline" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable" };

/**
 * What Disconnect really came to (#304). The first three are successes; "partial" ended the access but could not erase the saved
 * copy yet; "unavailable", "uncertain" and "pending" changed nothing; "offline" never reached the server; "signed-out" means the session
 * ended before the call, so nothing was changed. Every failure can be repeated (after signing in again, for the last).
 */
export type DisconnectResult = DisconnectOutcome | DisconnectFailure | "offline" | "signed-out";

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
  /** False outside the approved stable Preview/local origins (and outside the synthetic e2e build), and once the session has ended. */
  available: boolean;
  /** Null until the first answer from the server. */
  status: FeedbackStatus | null;
  /** The opaque key this account's on-device outbox is named by. Anything holding unsent work is dropped when it changes. */
  scopeKey: string | null;
  outbox: OutboxView;
  connect: (invitation: string) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;
  /** Asks the server again what this account holds (the newest answer wins). Account closure uses it after a refused attempt (#261). */
  refresh: () => Promise<void>;
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
  /**
   * Opens the report sheet, the same one the header Feedback button opens (#273): the Settings card's "Send feedback" action calls this.
   * Does nothing when no sheet is mounted. The sheet itself decides whether anything may be captured.
   */
  openReport: () => void;
  /** The header button's sheet registers itself here for `openReport`. Returns the unregister. */
  registerReportOpener: (open: () => void) => () => void;
  /** Deletes this account's unsent reports from this device. Sign-out does it itself; this is the explicit "clear" in Settings. */
  clearUnsent: () => Promise<void>;
  /** Sign-out: stops delivery and deletes this account's unsent notes and screenshots from this device. The server enrollment stays. */
  clearLocal: () => Promise<void>;
  /**
   * "Send now" for the sign-out warning (#325): wakes the SDK's own delivery (it still honours each report's saved retry time, so
   * nothing is re-implemented here) and resolves with how many reports are still on this device (waiting + blocked). Capped at 15 s;
   * a failure, a missing outbox or the cap all resolve with the count still left, never reject.
   */
  flushNow: () => Promise<number>;
}

/** The unsent total every warning and count uses: waiting plus blocked. */
export const unsentCount = (outbox: OutboxView) => outbox.waiting + outbox.blocked;
/** How long "Send now" waits for delivery before it counts as a partial failure. */
export const FLUSH_LIMIT_MS = 15_000;

const NO_OUTBOX: OutboxView = { waiting: 0, blocked: 0, state: "checking" };

const NOT_READY: FeedbackAccessValue = {
  available: false,
  status: null,
  scopeKey: null,
  outbox: NO_OUTBOX,
  connect: async () => ({ kind: "unavailable" }),
  disconnect: async () => "unavailable",
  refresh: async () => undefined,
  prepareReport: async () => {
    throw new Error("Feedback is not ready");
  },
  saveReport: async () => ({ ok: false, reason: "unavailable" }),
  subscribeReceipts: () => () => undefined,
  openReport: () => undefined,
  registerReportOpener: () => () => undefined,
  clearUnsent: async () => undefined,
  clearLocal: async () => undefined,
  flushNow: async () => 0,
};

const FeedbackAccessContext = createContext<FeedbackAccessValue>(NOT_READY);
const subscribeToFixedOrigin = () => () => undefined;
const serverFeedbackEnabled = () => feedbackE2eBuild;

export function useFeedbackAccess(): FeedbackAccessValue {
  return useContext(FeedbackAccessContext);
}

/** For the Sign out button: clear this account's unsent feedback from the device first. A no-op where feedback is not built in. */
export function useFeedbackSignOut(): () => Promise<void> {
  return useContext(FeedbackAccessContext).clearLocal;
}

const loadLocalExport = () => import("@masra91/framebriar/browser/local-export");

/** The SDK's own storage errors, as the four things the sheet can say. Unknown errors count as unavailable (nothing is claimed saved). */
export function saveFailure(error: unknown): Extract<SaveOutcome, { ok: false }> {
  const named = error as { code?: string; name?: string } | null;
  if (named?.name === "AbortError") return { ok: false, reason: "cancelled" };
  if (named?.code === "storage-full") return { ok: false, reason: "full" };
  if (named?.code === "storage-uncertain" || named?.code === "storage-timeout")
    return { ok: false, reason: "uncertain" };
  return { ok: false, reason: "unavailable" };
}

export function outboxView(status: OutboxStatus): OutboxView {
  return {
    waiting: status.items,
    blocked: status.blocked ?? 0,
    state: status.state === "storage-unavailable" ? "storage-unavailable" : "available",
  };
}

/** What the outbox needs from the provider: the account's key, the app's own transport, and where to report a confirmed receipt. */
export interface OutboxArguments {
  outboxKey: string;
  send: ReturnType<typeof createProxySend>;
  onReceipt: (receipt: { id: string }) => void;
}

/**
 * The durable on-device report outbox (#132), one database per account (#260). The SDK's queue is built here with a database named
 * from the account's opaque key, and the SDK's HTTPS + Bearer transport is replaced by the app's own authenticated route, so no
 * credential exists in the browser. Null where this browser has no IndexedDB, so a report can never be claimed saved when it was not.
 * The SDK is loaded here and nowhere on the server.
 */
export type CreateOutbox = (options: OutboxArguments) => Promise<DurableFeedback | null>;

export const loadOutbox: CreateOutbox = async ({ outboxKey, send, onReceipt }) => {
  if (typeof indexedDB === "undefined") return null;
  const [{ createDurableFeedback }, { OfflineQueue }] = await Promise.all([
    import("@masra91/framebriar/browser/durable-feedback"),
    import("@masra91/framebriar/browser/queue"),
  ]);
  return createDurableFeedback({
    gameId: FEEDBACK_GAME_ID,
    buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
    // Only validated by the SDK (HTTPS, no credentials); `send` below never uses it and no token exists to give.
    endpoint: `${PREVIEW_FEEDBACK_ORIGIN}${REPORTS_PATH}`,
    getToken: async () => undefined,
    queue: new OfflineQueue(accountScope(outboxKey)),
    send,
    onReceipt,
  });
};

/** Tabs of one browser tell each other when an account ends, so none keeps showing or sending its work. */
export interface AccountChannel {
  postMessage(message: string): void;
  close(): void;
  onmessage: ((event: MessageEvent) => unknown) | null;
}
const CHANNEL_NAME = "travel-packing-feedback-account";
const createBroadcastChannel = (): AccountChannel | null =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);

/** How long sign-out waits for the clear before it carries on (sign-out must never hang on a stuck database). */
export const SIGN_OUT_CLEAR_LIMIT_MS = 2500;
/** How long "too many for now" shows when the server did not say. */
const RATE_LIMIT_NOTE_MS = 60_000;

interface FeedbackAccessProviderProps {
  children: ReactNode;
  /** The browser's `fetch` unless a test injects one. */
  fetchImpl?: typeof fetch;
  createOutbox?: CreateOutbox;
  /** Fetches the code that prepares a report, ahead of Send. Injectable so a test can see that it happens. */
  preload?: () => Promise<unknown>;
  /** The browser's IndexedDB unless a test injects one. */
  indexedDBImpl?: IDBFactory;
  createChannel?: () => AccountChannel | null;
  /** Explicit only for unit tests. The app always uses the compile-time build gate plus the exact runtime origin. */
  enabled?: boolean;
}

export function FeedbackAccessProvider({ enabled, ...props }: FeedbackAccessProviderProps) {
  // useSyncExternalStore gives local development a disabled server snapshot for hydration, then reads the browser's exact
  // origin. The origin cannot change during a document's lifetime, so there is nothing to subscribe to.
  const runtimeEnabled = useSyncExternalStore(
    subscribeToFixedOrigin,
    feedbackRuntimeEnabled,
    serverFeedbackEnabled,
  );
  if (!(enabled ?? runtimeEnabled)) return props.children;
  return <EnabledFeedbackAccessProvider {...props} />;
}

function EnabledFeedbackAccessProvider({
  children,
  fetchImpl,
  createOutbox = loadOutbox,
  preload = loadLocalExport,
  indexedDBImpl,
  createChannel = createBroadcastChannel,
}: Omit<FeedbackAccessProviderProps, "enabled">) {
  const [view, setView] = useState<EnrollmentView | null>(null);
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [outboxState, setOutboxState] = useState<{ key: string; view: OutboxView } | null>(null);

  const fetchRef = useRef<typeof fetch | null>(null);
  const idbRef = useRef<IDBFactory | undefined>(undefined);
  const viewRef = useRef<EnrollmentView | null>(null);
  const boxRef = useRef<{ key: string; box: DurableFeedback | null } | null>(null);
  const receipts = useRef(new Set<(id: string) => void>());
  const channelRef = useRef<AccountChannel | null>(null);
  const sequence = useRef(0);
  /** The latest unsent total, for `flushNow` when no outbox is mounted. */
  const unsentRef = useRef(0);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetchRef.current = fetchImpl ?? ((...args) => fetch(...args));
    idbRef.current = indexedDBImpl ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    viewRef.current = view;
  });

  /** Asks the server what this account's enrollment is. The newest answer wins; an older one that arrives late is dropped. */
  const refresh = useCallback(async () => {
    const mine = ++sequence.current;
    const result = await readEnrollment(fetchRef.current ?? undefined);
    if (mine !== sequence.current) return;
    if (result.kind === "ok") {
      setSignedOut(false);
      setOnline(true);
      setView(result.view);
    } else if (result.kind === "signed-out") {
      setSignedOut(true);
    } else if (result.kind === "offline") {
      setOnline(false);
    } else {
      // The server answered with something unusable: say so, and keep naming the account's storage as before.
      setOnline(true);
      setView((previous) => ({
        status: "unavailable",
        expiresAt: null,
        redemption: "none",
        hasRecord: previous?.hasRecord ?? false,
        outboxKey: previous?.outboxKey ?? null,
      }));
    }
  }, []);

  const noteRateLimit = useCallback((seconds: number | null) => {
    setRateLimited(true);
    clearTimeout(limitTimer.current);
    const wait = seconds === null ? RATE_LIMIT_NOTE_MS : Math.min(seconds * 1000, 600_000);
    limitTimer.current = setTimeout(() => setRateLimited(false), wait);
  }, []);

  // Look at the account when the page loads and each time it could have changed: it came back from the cache or the background
  // (another tab may have signed someone else in), or the connection returned. The status route never calls Framebriar.
  useEffect(() => {
    const goOffline = () => setOnline(false);
    const again = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    void refresh();
    window.addEventListener("online", again);
    window.addEventListener("offline", goOffline);
    window.addEventListener("pageshow", again);
    document.addEventListener("visibilitychange", again);
    const timer = limitTimer;
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("pageshow", again);
      document.removeEventListener("visibilitychange", again);
      clearTimeout(timer.current);
    };
  }, [refresh]);

  // The #137 version kept a refresh credential and an owner-less outbox in this browser. Neither exists any more; delete them once.
  useEffect(() => {
    const factory = idbRef.current;
    if (factory) void deleteLegacyDatabases(factory).catch(() => undefined);
  }, []);

  // Another tab ended or switched the account: look again, which stops this tab's delivery and drops its work if the key changed.
  useEffect(() => {
    const channel = createChannel();
    channelRef.current = channel;
    if (channel) channel.onmessage = () => void refresh();
    return () => {
      if (channel) channel.onmessage = null;
      channel?.close();
      channelRef.current = null;
    };
  }, [createChannel, refresh]);

  // One send for this provider: it will not even ask the server while the enrollment is not connected, and it hears when the
  // server says the enrollment (or the rate limit) is the problem.
  const send = useMemo(
    () =>
      createProxySend({
        fetchImpl: (...args) => (fetchRef.current ?? fetch)(...args),
        isConnected: () => viewRef.current?.status === "connected",
        onEnrollmentProblem: () => void refresh(),
        onRateLimited: noteRateLimit,
      }),
    [refresh, noteRateLimit],
  );

  const outboxKey = signedOut ? null : (view?.outboxKey ?? null);

  // This account's outbox. Opening it first sweeps away every other account's (an account switch clears the previous account's
  // unsent notes). With no key (signed out, or the server cannot name one) there is no outbox at all, so nothing can be saved or sent.
  useEffect(() => {
    if (!outboxKey) return;
    let cancelled = false;
    let unregisterAccountClosureCleanup: () => void = () => undefined;
    let box: DurableFeedback | null = null;
    let unsubscribe: (() => void) | undefined;
    const stop = () => box?.stop();
    const resume = () => void box?.start().catch(() => undefined);
    void (async () => {
      const factory = idbRef.current;
      if (factory) await sweepOtherAccounts(factory, outboxKey).catch(() => undefined);
      if (cancelled) return;
      const created = await createOutbox({
        outboxKey,
        send,
        onReceipt: ({ id }) => {
          for (const listener of receipts.current) listener(id);
        },
      }).catch(() => null);
      if (cancelled) {
        created?.stop();
        return;
      }
      box = created;
      boxRef.current = { key: outboxKey, box: created };
      unregisterAccountClosureCleanup = registerAccountClosureFeedbackCleanup(async () => {
        if (boxRef.current?.key === outboxKey) boxRef.current = null;
        created?.stop();
        await created?.clear().catch(() => undefined);
        const currentFactory = idbRef.current;
        if (currentFactory)
          await deleteAccountOutbox(currentFactory, outboxKey).catch(() => undefined);
        channelRef.current?.postMessage("account-ended");
      });
      // Saving must work with no connection at all, so the code that prepares a report is fetched now, not at Send.
      void preload().catch(() => undefined);
      if (created) {
        unsubscribe = created.subscribe((next) =>
          setOutboxState({ key: outboxKey, view: outboxView(next) }),
        );
      } else {
        setOutboxState({ key: outboxKey, view: { ...NO_OUTBOX, state: "storage-unavailable" } });
      }
      window.addEventListener("pagehide", stop);
      window.addEventListener("pageshow", resume);
      resume();
    })();
    return () => {
      cancelled = true;
      unregisterAccountClosureCleanup();
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", resume);
      unsubscribe?.();
      box?.stop();
      if (boxRef.current?.box === box) boxRef.current = null;
    };
  }, [outboxKey, createOutbox, preload, send]);

  // Whatever is waiting is tried again once the account is connected (the SDK still honours each report's saved retry time).
  const connected = view?.status === "connected";
  useEffect(() => {
    if (connected) void boxRef.current?.box?.resume().catch(() => undefined);
  }, [connected, outboxKey]);

  const connect = useCallback(
    async (invitation: string): Promise<ConnectResult> => {
      const result = await redeemInvitation(invitation, fetchRef.current ?? undefined);
      switch (result.kind) {
        case "connected":
        case "already-connected":
          await refresh();
          return { kind: "connected" };
        case "rejected":
          return { kind: "invalid" };
        case "uncertain":
          // The answer was lost: the status now says a redemption is pending, so Settings can ask for the same invitation again.
          await refresh();
          return { kind: "uncertain" };
        case "rate-limited":
          return { kind: "rate-limited", retryAfterSeconds: result.retryAfterSeconds };
        case "signed-out":
          setSignedOut(true);
          return { kind: "unavailable" };
        case "offline":
          setOnline(false);
          return { kind: "offline" };
        default:
          return { kind: "unavailable" };
      }
    },
    [refresh],
  );

  const disconnect = useCallback(async (): Promise<DisconnectResult> => {
    const result = await disconnectEnrollment(fetchRef.current ?? undefined);
    if (result.kind === "done") {
      await refresh();
      return result.outcome;
    }
    if (result.kind === "offline") {
      setOnline(false);
      return "offline";
    }
    if (result.kind === "signed-out") {
      setSignedOut(true);
      return "signed-out";
    }
    return result.reason;
  }, [refresh]);

  const prepareReport = useCallback<FeedbackAccessValue["prepareReport"]>(
    async ({ notes, screenshot, context }) => {
      const { prepareLocalFeedback } = await loadLocalExport();
      return prepareLocalFeedback({ blob: screenshot, captureContext: context, notes });
    },
    [],
  );

  const saveReport = useCallback<FeedbackAccessValue["saveReport"]>(async (prepared, signal) => {
    const box = boxRef.current?.box;
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

  const clearUnsent = useCallback(async () => {
    await boxRef.current?.box?.clear().catch(() => undefined);
  }, []);

  const clearLocal = useCallback(async () => {
    const current = boxRef.current;
    boxRef.current = null;
    const work = (async () => {
      // Nothing in the clear may stop sign-out (#325 S1): a throwing stop() must not skip the clear or reject the race.
      try {
        current?.box?.stop();
      } catch {
        /* the clear below still runs */
      }
      await current?.box?.clear().catch(() => undefined);
      const factory = idbRef.current;
      if (current && factory)
        await deleteAccountOutbox(factory, current.key).catch(() => undefined);
    })();
    await Promise.race([work, new Promise((done) => setTimeout(done, SIGN_OUT_CLEAR_LIMIT_MS))]);
    try {
      channelRef.current?.postMessage("account-ended");
    } catch {
      /* other tabs learn on their next look */
    }
  }, []);

  const flushNow = useCallback(async (): Promise<number> => {
    const box = boxRef.current?.box;
    if (!box) return unsentRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        box.start(),
        new Promise((done) => {
          timer = setTimeout(done, FLUSH_LIMIT_MS);
        }),
      ]);
    } catch {
      /* a failed send is a partial failure: the count below says what is left */
    } finally {
      clearTimeout(timer);
    }
    return unsentCount(outboxView(box.status()));
  }, []);

  const reportOpener = useRef<(() => void) | null>(null);
  const openReport = useCallback(() => reportOpener.current?.(), []);
  const registerReportOpener = useCallback((open: () => void) => {
    reportOpener.current = open;
    return () => {
      if (reportOpener.current === open) reportOpener.current = null;
    };
  }, []);

  const status = useMemo(
    () => (view && !signedOut ? feedbackStatus(view, { online, rateLimited }) : null),
    [view, signedOut, online, rateLimited],
  );
  const outbox = outboxState && outboxState.key === outboxKey ? outboxState.view : NO_OUTBOX;
  useEffect(() => {
    unsentRef.current = unsentCount(outbox);
  });

  const value = useMemo<FeedbackAccessValue>(
    () => ({
      available: !signedOut,
      status,
      scopeKey: outboxKey,
      outbox,
      connect,
      disconnect,
      refresh,
      prepareReport,
      saveReport,
      subscribeReceipts,
      openReport,
      registerReportOpener,
      clearUnsent,
      clearLocal,
      flushNow,
    }),
    [
      refresh,
      signedOut,
      status,
      outboxKey,
      outbox,
      connect,
      disconnect,
      prepareReport,
      saveReport,
      subscribeReceipts,
      openReport,
      registerReportOpener,
      clearUnsent,
      clearLocal,
      flushNow,
    ],
  );
  return <FeedbackAccessContext.Provider value={value}>{children}</FeedbackAccessContext.Provider>;
}
