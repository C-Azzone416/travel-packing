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
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { SaveChip, type SaveStatus } from "./SaveChip";

// "Saving…" appears only if a write takes longer than this, to avoid flicker (#31).
export const SAVING_DELAY_MS = 400;
// Successful saves stay visible long enough to notice, then the header returns to its quiet state.
export const SAVED_CONFIRMATION_MS = 2_000;

interface PendingWrite {
  write: () => Promise<unknown>;
  onSuccess?: (result: never) => void;
  read: boolean;
}

export interface TrackOptions {
  /**
   * A read (a load) never shows "Saving…" and never announces it, because nothing is being saved. A
   * failed read still shows the Error state with Retry, and a successful retry clears it.
   */
  read?: boolean;
}

interface SaveStatusApi {
  status: SaveStatus;
  /**
   * Run a write, reflecting it in the chip. Rejects with the write's own error. `onSuccess` receives
   * the result, and is kept with the write so a Retry delivers the result to the screen too.
   */
  track: <T>(
    write: () => Promise<T>,
    onSuccess?: (result: T) => void,
    options?: TrackOptions,
  ) => Promise<T>;
  /** When the last write succeeded (a read never counts), or null if nothing has been saved yet this visit. */
  lastSavedAt: Date | null;
  /** Re-run the last FAILED write only. A newer successful write clears it, so stale writes never replay. */
  retry: () => void;
  /** True while a non-read write is in flight, including the short delay before `status` becomes "saving". */
  pending: boolean;
}

const SaveStatusContext = createContext<SaveStatusApi | null>(null);

export function useSaveStatus(): SaveStatusApi {
  const api = useContext(SaveStatusContext);
  if (!api) throw new Error("useSaveStatus must be used inside <SaveStatusProvider>");
  return api;
}

const ANNOUNCE: Record<SaveStatus, string> = {
  idle: "",
  saved: "Saved",
  saving: "Saving",
  error: "Couldn't save your last change. Retry is available.",
};

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const statusRef = useRef<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const pending = useRef(0);
  // A React mirror of `pending.current > 0`, so the Settings card can say "Saving…" before the chip's delay passes.
  const [hasPending, setHasPending] = useState(false);
  const lastFailed = useRef<PendingWrite | null>(null);
  const savingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);

  const applyStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearSavingTimer = useCallback(() => {
    if (!savingTimer.current) return;
    clearTimeout(savingTimer.current);
    savingTimer.current = null;
  }, []);

  const clearSavedTimer = useCallback(() => {
    if (!savedTimer.current) return;
    clearTimeout(savedTimer.current);
    savedTimer.current = null;
  }, []);

  const scheduleSaving = useCallback(() => {
    if (savingTimer.current || failed.current || pending.current === 0) return;
    savingTimer.current = setTimeout(() => {
      savingTimer.current = null;
      if (!failed.current && pending.current > 0) applyStatus("saving");
    }, SAVING_DELAY_MS);
  }, [applyStatus]);

  const showSavedConfirmation = useCallback(() => {
    clearSavedTimer();
    applyStatus("saved");
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      if (statusRef.current === "saved") applyStatus("idle");
    }, SAVED_CONFIRMATION_MS);
  }, [applyStatus, clearSavedTimer]);

  useEffect(
    () => () => {
      clearSavingTimer();
      clearSavedTimer();
    },
    [clearSavedTimer, clearSavingTimer],
  );

  const track = useCallback(
    async <T,>(
      write: () => Promise<T>,
      onSuccess?: (result: T) => void,
      options?: TrackOptions,
    ): Promise<T> => {
      const read = options?.read ?? false;
      if (!read) {
        clearSavedTimer();
        if (statusRef.current === "saved") applyStatus("idle");
        pending.current += 1;
        setHasPending(true);
        scheduleSaving();
      }
      const settle = () => {
        if (read) return;
        pending.current -= 1;
        setHasPending(pending.current > 0);
        if (pending.current === 0) clearSavingTimer();
      };
      try {
        const result = await write();
        settle();
        // A newer successful write makes any earlier failure stale: clear it, and the Error state with
        // it. A successful read only clears a failed READ (a failed save stays until a save succeeds).
        if (!read || lastFailed.current?.read) {
          lastFailed.current = null;
          failed.current = false;
          if (pending.current === 0) {
            if (read) applyStatus("idle");
            else showSavedConfirmation();
          } else if (statusRef.current === "error") {
            applyStatus("idle");
            scheduleSaving();
          }
        }
        if (!read) setLastSavedAt(new Date());
        onSuccess?.(result);
        return result;
      } catch (error) {
        settle();
        clearSavingTimer();
        clearSavedTimer();
        lastFailed.current = { write, onSuccess: onSuccess as PendingWrite["onSuccess"], read };
        failed.current = true;
        applyStatus("error");
        throw error;
      }
    },
    [applyStatus, clearSavedTimer, clearSavingTimer, scheduleSaving, showSavedConfirmation],
  );

  const retry = useCallback(() => {
    const failedWrite = lastFailed.current;
    if (failedWrite)
      void track(failedWrite.write, failedWrite.onSuccess as (result: unknown) => void, {
        read: failedWrite.read,
      }).catch(() => {});
  }, [track]);

  const api = useMemo<SaveStatusApi>(
    () => ({ status, lastSavedAt, track, retry, pending: hasPending }),
    [status, lastSavedAt, track, retry, hasPending],
  );

  // While a change is unsaved, leaving the page asks first (design's #31).
  useEffect(() => {
    if (status !== "error") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <SaveChip status={status} onOpenError={() => setOpen(true)} />
      <ModalSheet
        open={open && status === "error"}
        title="Couldn’t save"
        description="Your change is still on screen. Retry to save it."
        onClose={close}
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Dismiss
            </Button>
            <Button
              onClick={() => {
                close();
                retry();
              }}
            >
              Retry
            </Button>
          </>
        }
      >
        {null}
      </ModalSheet>
    </>
  );
}
