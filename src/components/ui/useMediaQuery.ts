"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches now, and again when it changes. Server and first paint say false (the phone layout),
 * so a screen that picks a different control on a laptop must only call this after its data has loaded on the client.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}

/** The redesign's single breakpoint (spec part 1 section 1): laptop layouts start at 1024px. */
export const LAPTOP_QUERY = "(min-width: 1024px)";
