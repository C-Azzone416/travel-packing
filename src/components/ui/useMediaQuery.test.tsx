// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAPTOP_QUERY, useMediaQuery } from "./useMediaQuery";

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe("useMediaQuery", () => {
  it("is false where media queries do not exist", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useMediaQuery(LAPTOP_QUERY));
    expect(result.current).toBe(false);
  });

  it("reads the query, follows changes, and stops listening on unmount", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const remove = vi.fn((_: string, fn: () => void) => listeners.delete(fn));
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: remove,
    })) as unknown as typeof window.matchMedia;
    const { result, unmount } = renderHook(() => useMediaQuery(LAPTOP_QUERY));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((fn) => fn());
    });
    expect(result.current).toBe(true);
    unmount();
    expect(remove).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
