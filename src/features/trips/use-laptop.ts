"use client";

import { useSyncExternalStore } from "react";

/** The one breakpoint: laptop layouts from 1024px up (spec on #376 part 1 section 1). */
export const LAPTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const list = window.matchMedia(LAPTOP_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(LAPTOP_QUERY).matches
    : false;

/** True at laptop width. False on the server and where matchMedia is missing, so the phone layout is the safe default. */
export function useLaptop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
