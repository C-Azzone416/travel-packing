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

// Plain toasts last 4s; toasts carrying an action (Undo) last 8s. Both pause
// while hovered or focused so keyboard and pointer users can reach the action.
export const TOAST_MS = 4000;
export const ACTION_TOAST_MS = 8000;

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastEntry {
  id: number;
  message: string;
  action?: ToastAction;
}

export interface ToastApi {
  show: (message: string, options?: { action?: ToastAction }) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastEntry | null>(null);
  const [error, setError] = useState<{ id: number; message: string } | null>(null);
  const nextId = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);

  const show = useCallback<ToastApi["show"]>((message, options) => {
    hovered.current = false;
    focused.current = false;
    setToast({ id: ++nextId.current, message, action: options?.action });
  }, []);
  const showError = useCallback(
    (message: string) => setError({ id: ++nextId.current, message }),
    [],
  );
  const api = useMemo<ToastApi>(() => ({ show, error: showError }), [show, showError]);

  const [paused, setPaused] = useState(false);
  const toastId = toast?.id;
  const duration = toast?.action ? ACTION_TOAST_MS : TOAST_MS;
  useEffect(() => {
    if (toastId === undefined || paused) return;
    const timer = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(timer);
  }, [toastId, duration, paused]);

  const syncPaused = () => setPaused(hovered.current || focused.current);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toast ? (
          <div
            key={toast.id}
            className="toast"
            onMouseEnter={() => {
              hovered.current = true;
              syncPaused();
            }}
            onMouseLeave={() => {
              hovered.current = false;
              syncPaused();
            }}
            onFocus={() => {
              focused.current = true;
              syncPaused();
            }}
            onBlur={() => {
              focused.current = false;
              syncPaused();
            }}
          >
            <span>{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onAction();
                  setToast(null);
                  setPaused(false);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="error-region" role="alert" aria-live="assertive" aria-atomic="true">
        {error ? (
          <div key={error.id} className="error-banner">
            <span>{error.message}</span>
            <button type="button" className="button danger small" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
