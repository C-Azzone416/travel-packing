"use client";

import { useSyncExternalStore } from "react";

/** The one layout breakpoint of the Suitcase redesign (#376 part 1): the laptop layouts start here. */
export const LAPTOP_MIN_WIDTH = 1024;

/** Tablet layouts (768-1023, #414) sit inside the phone shell; they only change the content layout. */
export const TABLET_MIN_WIDTH = 768;

/**
 * Whether the viewport is at least `px` wide, kept in step with resizes. False on the server and where `matchMedia` does
 * not exist (so a test that never sets it gets the narrow layout). Read it only after hydration has shown something
 * client-only: the first client render must match the server's.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    () => false,
  );
}
