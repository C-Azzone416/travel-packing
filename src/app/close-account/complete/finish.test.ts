import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CLOSURE_STEP_TIMEOUT_MS, finishAccountClosure } from "./finish";

afterEach(() => vi.useRealTimers());

describe("finishAccountClosure", () => {
  it("runs client cleanup only after confirmed one-time signal consumption, then navigates", async () => {
    const cleanup = vi.fn(async () => {});
    const navigate = vi.fn();
    await finishAccountClosure({ consume: async () => true, cleanup, navigate });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not clean up for a missing, consumed, or invalid signal", async () => {
    const cleanup = vi.fn(async () => {});
    const navigate = vi.fn();
    await finishAccountClosure({ consume: async () => false, cleanup, navigate });
    expect(cleanup).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each(["signal failure", "cleanup failure"])("still navigates after %s", async (failure) => {
    const cleanup = vi.fn(async () => {
      if (failure === "cleanup failure") throw new Error("local cleanup unavailable");
    });
    const navigate = vi.fn();
    await expect(
      finishAccountClosure({
        consume: async () => {
          if (failure === "signal failure") throw new Error("network unavailable");
          return true;
        },
        cleanup,
        navigate,
      }),
    ).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(failure === "cleanup failure" ? 1 : 0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each(["signal timeout", "cleanup timeout"])("still navigates after %s", async (failure) => {
    vi.useFakeTimers();
    const cleanup = vi.fn(() =>
      failure === "cleanup timeout" ? new Promise<void>(() => {}) : Promise.resolve(),
    );
    const navigate = vi.fn();
    const finished = finishAccountClosure({
      consume: () =>
        failure === "signal timeout" ? new Promise<boolean>(() => {}) : Promise.resolve(true),
      cleanup,
      navigate,
    });
    await vi.advanceTimersByTimeAsync(ACCOUNT_CLOSURE_STEP_TIMEOUT_MS);
    await finished;
    expect(cleanup).toHaveBeenCalledTimes(failure === "cleanup timeout" ? 1 : 0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
