// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSignOut } from "./use-sign-out";

describe("useSignOut", () => {
  it("signs out where feedback is not built in (nothing to clear), with no sheet open", async () => {
    const signOut = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSignOut(signOut));
    await result.current.action();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.sheet).toBeTruthy();
  });

  it("is a no-op without a sign-out action (a Nav with nobody signed in never calls it)", async () => {
    const { result } = renderHook(() => useSignOut(undefined));
    await expect(result.current.action()).resolves.toBeUndefined();
  });
});
