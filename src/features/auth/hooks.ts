"use client";

import { useEffect, useRef, useState } from "react";

/** True once `active` has stayed true for `delayMs`: the "Working…" label only shows when waiting is noticeable. */
export function useDelayed(active: boolean, delayMs = 400): boolean {
  const [delayed, setDelayed] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  // Going idle starts the next wait from zero (adjusting state while rendering, the documented way to reset on a change).
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setDelayed(false);
  }
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && delayed;
}

/** A ref for the screen's heading that takes focus on mount and whenever `key` changes (a new screen in the same route). */
export function useHeadingFocus<Key>(key: Key) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}

/** After each answer with a field problem, focus the first invalid field (and select a code so it can be retyped). */
export function useFocusInvalid<State>(state: State, hasFieldError: boolean) {
  const ref = useRef<HTMLFormElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!hasFieldError) return;
    const field = ref.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    field?.focus();
    if (field?.dataset.selectOnError !== undefined) field.select();
  }, [state, hasFieldError]);
  return ref;
}

/**
 * A countdown in whole seconds. `start(seconds)` begins (or restarts) it; it ticks once a second, stops at 0, and then calls
 * `onEnd` once. Call `start` from an event or an action callback, never while rendering.
 */
export function useCountdown(initial: number, onEnd?: () => void) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(initial)));
  const left = useRef(remaining);
  const ending = useRef(onEnd);
  useEffect(() => {
    ending.current = onEnd;
  });
  const running = remaining > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      left.current = Math.max(0, left.current - 1);
      setRemaining(left.current);
      if (left.current === 0) {
        clearInterval(timer);
        ending.current?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  return {
    remaining,
    start(seconds: number) {
      left.current = Math.max(0, Math.ceil(seconds));
      setRemaining(left.current);
    },
  };
}
