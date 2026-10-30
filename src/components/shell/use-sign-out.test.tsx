// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSignOut } from "./use-sign-out";

describe("useSignOut", () => {
  it("signs out where feedback is not built in (nothing to clear)", async () => {
    const signOut = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSignOut(signOut));
    await result.current();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without a sign-out action (a Nav with nobody signed in never calls it)", async () => {
    const { result } = renderHook(() => useSignOut(undefined));
    await expect(result.current()).resolves.toBeUndefined();
  });
});
