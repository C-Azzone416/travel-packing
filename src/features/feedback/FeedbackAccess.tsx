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
import type { AccessStatus, PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import { feedbackBuildSha } from "./build-sha";

export const FEEDBACK_GAME_ID = "travel-packing";

export type ConnectResult = "connected" | "invalid" | "offline" | "uncertain";
export type DisconnectResult = "ended" | "device-only";

export interface FeedbackAccessValue {
  /** Null until the first answer from the access controller (it restores any saved connection first). */
  status: AccessStatus | null;
  /** Reports waiting and blocked on this device. The report outbox arrives with #132; until then both are 0. */
  outbox: { waiting: number; blocked: number };
  connect: (invitation: string) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;
}

const NOT_READY: FeedbackAccessValue = {
  status: null,
  outbox: { waiting: 0, blocked: 0 },
  connect: async () => "uncertain",
  disconnect: async () => "device-only",
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

export function resultAfterFailedConnect(status: AccessStatus, online: boolean): ConnectResult {
  if (status.notice === "connection-uncertain") return "uncertain";
  return online ? "invalid" : "offline";
}

// One access controller for the whole signed-in visit (#131). It restores a saved connection on load, stands down while
// the page is hidden or frozen (pagehide) and picks up again when it returns (pageshow). It never redeems anything by itself.
export function FeedbackAccessProvider({
  children,
  create = loadAccess,
}: {
  children: ReactNode;
  create?: () => Promise<PlaytestAccess>;
}) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const accessRef = useRef<PlaytestAccess | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let stop = () => undefined as void;
    let resume = () => undefined as void;
    create()
      .then((access) => {
        if (cancelled) {
          access.dispose();
          return;
        }
        accessRef.current = access;
        unsubscribe = access.subscribe(setStatus);
        stop = () => access.stop();
        resume = () => void access.start().catch(() => undefined);
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
      accessRef.current?.dispose();
      accessRef.current = null;
    };
  }, [create]);

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

  const value = useMemo<FeedbackAccessValue>(
    () => ({ status, outbox: { waiting: 0, blocked: 0 }, connect, disconnect }),
    [status, connect, disconnect],
  );
  return <FeedbackAccessContext.Provider value={value}>{children}</FeedbackAccessContext.Provider>;
}
