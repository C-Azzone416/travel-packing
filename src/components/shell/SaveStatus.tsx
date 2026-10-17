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
import { SaveChip, type SaveStatus } from "./SaveChip";

// "Saving…" appears only if a write takes longer than this, to avoid flicker (#31).
export const SAVING_DELAY_MS = 400;

type Write = () => Promise<unknown>;

interface SaveStatusApi {
  status: SaveStatus;
  /** Run a write, reflecting it in the chip. Rejects with the write's own error. */
  track: <T>(write: () => Promise<T>) => Promise<T>;
  /** Re-run the last FAILED write only. A newer successful write clears it, so stale writes never replay. */
  retry: () => void;
}

const SaveStatusContext = createContext<SaveStatusApi | null>(null);

export function useSaveStatus(): SaveStatusApi {
  const api = useContext(SaveStatusContext);
  if (!api) throw new Error("useSaveStatus must be used inside <SaveStatusProvider>");
  return api;
}

const ANNOUNCE: Record<SaveStatus, string> = {
  saved: "Saved",
  saving: "Saving",
  error: "Couldn't save your last change. Retry is available.",
};

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const pending = useRef(0);
  const lastFailed = useRef<Write | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const track = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    pending.current += 1;
    if (!timer.current && !failed.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setStatus((current) => (current === "error" ? current : "saving"));
      }, SAVING_DELAY_MS);
    }
    const settle = () => {
      pending.current -= 1;
      if (pending.current === 0 && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    try {
      const result = await write();
      settle();
      // A newer success makes any earlier failure stale: clear it, and the Error state with it.
      lastFailed.current = null;
      failed.current = false;
      if (pending.current === 0) setStatus("saved");
      return result;
    } catch (error) {
      settle();
      lastFailed.current = write;
      failed.current = true;
      setStatus("error");
      throw error;
    }
  }, []);

  const retry = useCallback(() => {
    const write = lastFailed.current;
    if (write) void track(write).catch(() => {});
  }, [track]);

  const api = useMemo<SaveStatusApi>(() => ({ status, track, retry }), [status, track, retry]);

  return (
    <SaveStatusContext.Provider value={api}>
      {children}
      <span className="sr-only" role="status" aria-label="Save status">
        {status === "error" ? "" : ANNOUNCE[status]}
      </span>
      <span className="sr-only" role="alert" aria-label="Save error">
        {status === "error" ? ANNOUNCE.error : ""}
      </span>
    </SaveStatusContext.Provider>
  );
}

// The top-bar chip, driven by whatever writes are in flight.
export function ConnectedSaveChip() {
  const { status, retry } = useSaveStatus();
  return <SaveChip status={status} onRetry={retry} />;
}
