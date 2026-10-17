// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedSaveChip,
  SAVING_DELAY_MS,
  SaveStatusProvider,
  useSaveStatus,
} from "./SaveStatus";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

type Api = ReturnType<typeof useSaveStatus>;
let api: Api;
function Capture() {
  const value = useSaveStatus();
  useEffect(() => {
    api = value;
  });
  return null;
}

function setup() {
  return render(
    <SaveStatusProvider>
      <ConnectedSaveChip />
      <Capture />
    </SaveStatusProvider>,
  );
}

// A write the test settles by hand.
function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const chipText = () => (document.querySelector(".sync-chip") as HTMLElement).textContent;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const status = () => screen.getByRole("status", { name: "Save status" }).textContent;
const alertText = () => screen.getByRole("alert", { name: "Save error" }).textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SaveStatusProvider", () => {
  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Capture />)).toThrow(/SaveStatusProvider/);
    spy.mockRestore();
  });

  it("starts as Saved, announced politely", () => {
    setup();
    expect(chipText()).toContain("Saved");
    expect(status()).toBe("Saved");
    expect(alertText()).toBe("");
  });

  it("never flashes Saving for a write that finishes within the delay", async () => {
    setup();
    const write = deferred();
    let result: Promise<string>;
    act(() => {
      result = api.track(() => write.promise);
    });
    await advance(SAVING_DELAY_MS - 1);
    expect(chipText()).toContain("Saved");
    await act(async () => {
      write.resolve("ok");
      await result;
    });
    await advance(SAVING_DELAY_MS * 5);
    expect(chipText()).toContain("Saved");
  });

  it("shows Saving only after 400ms, announces it, then returns to Saved", async () => {
    setup();
    expect(SAVING_DELAY_MS).toBe(400);
    const write = deferred();
    let result: Promise<string>;
    act(() => {
      result = api.track(() => write.promise);
    });
    await advance(399);
    expect(chipText()).toContain("Saved");
    await advance(1);
    expect(chipText()).toContain("Saving…");
    expect(status()).toBe("Saving");
    await act(async () => {
      write.resolve("ok");
      await expect(result).resolves.toBe("ok");
    });
    expect(chipText()).toContain("Saved");
    expect(status()).toBe("Saved");
  });

  it("goes straight to Error on failure, rethrows, and announces assertively", async () => {
    setup();
    await act(async () => {
      await expect(api.track(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    });
    expect(chipText()).toContain("Couldn't save · Retry");
    expect(document.querySelector("button.sync-chip")).not.toBeNull();
    expect(alertText()).toContain("Couldn't save your last change");
    expect(status()).toBe("");
  });

  it("stays in Error (no Saving flash) while another write is in flight, until one succeeds", async () => {
    setup();
    await act(async () => {
      await api.track(() => Promise.reject(new Error("boom"))).catch(() => {});
    });
    const write = deferred();
    act(() => {
      void api.track(() => write.promise);
    });
    await advance(SAVING_DELAY_MS * 2);
    expect(chipText()).toContain("Couldn't save");
    await act(async () => {
      write.resolve("ok");
    });
    expect(chipText()).toContain("Saved");
  });

  it("retry re-runs only the last failed write and clears Error on success", async () => {
    setup();
    const first = vi.fn().mockRejectedValue(new Error("a"));
    const second = vi.fn().mockRejectedValue(new Error("b"));
    await act(async () => {
      await api.track(first).catch(() => {});
      await api.track(second).catch(() => {});
    });
    second.mockResolvedValue("ok");
    await act(async () => {
      api.retry();
    });
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(chipText()).toContain("Saved");
    // Nothing left to replay.
    await act(async () => {
      api.retry();
    });
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("a newer successful write makes the failed one stale, so retry never replays it", async () => {
    setup();
    const failed = vi.fn().mockRejectedValue(new Error("a"));
    await act(async () => {
      await api.track(failed).catch(() => {});
    });
    await act(async () => {
      await api.track(() => Promise.resolve("newer"));
    });
    expect(chipText()).toContain("Saved");
    await act(async () => {
      api.retry();
    });
    expect(failed).toHaveBeenCalledOnce();
    expect(chipText()).toContain("Saved");
  });

  it("stays in Error when the retry fails again, and keeps retrying the same write", async () => {
    setup();
    const write = vi.fn().mockRejectedValue(new Error("still down"));
    await act(async () => {
      await api.track(write).catch(() => {});
    });
    await act(async () => {
      api.retry();
    });
    expect(chipText()).toContain("Couldn't save");
    write.mockResolvedValue("ok");
    await act(async () => {
      api.retry();
    });
    expect(write).toHaveBeenCalledTimes(3);
    expect(chipText()).toContain("Saved");
  });

  it("the chip's Retry button retries", async () => {
    setup();
    const write = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("ok");
    await act(async () => {
      await api.track(write).catch(() => {});
    });
    await act(async () => {
      (document.querySelector("button.sync-chip") as HTMLButtonElement).click();
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(chipText()).toContain("Saved");
  });

  it("hands a successful result to onSuccess, and not a failed one", async () => {
    setup();
    const onSuccess = vi.fn();
    await act(async () => {
      await api.track(() => Promise.resolve("done"), onSuccess);
      await api.track(() => Promise.reject(new Error("x")), onSuccess).catch(() => {});
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith("done");
  });

  it("a Retry delivers the retried result to the original onSuccess, so the screen updates", async () => {
    setup();
    const onSuccess = vi.fn();
    const write = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("fresh");
    await act(async () => {
      await api.track(write, onSuccess).catch(() => {});
    });
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => {
      api.retry();
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith("fresh");
  });

  it("a slow write whose timer fires after another write failed does not mask the Error state", async () => {
    setup();
    const slow = deferred();
    act(() => {
      void api.track(() => slow.promise);
    });
    await act(async () => {
      await api.track(() => Promise.reject(new Error("x"))).catch(() => {});
    });
    expect(chipText()).toContain("Couldn't save");
    await advance(SAVING_DELAY_MS * 2);
    expect(chipText()).toContain("Couldn't save");
    expect(chipText()).not.toContain("Saving…");
  });

  describe("reads", () => {
    it("a slow read never shows or announces Saving, and still delivers its result", async () => {
      setup();
      const load = deferred();
      const onSuccess = vi.fn();
      let result: Promise<string>;
      act(() => {
        result = api.track(() => load.promise, onSuccess, { read: true });
      });
      await advance(SAVING_DELAY_MS * 10);
      expect(chipText()).toContain("Saved");
      expect(chipText()).not.toContain("Saving");
      expect(status()).toBe("Saved");
      await act(async () => {
        load.resolve("loaded");
        await result;
      });
      expect(onSuccess).toHaveBeenCalledWith("loaded");
      expect(chipText()).toContain("Saved");
    });

    it("a slow write still shows Saving after 400ms, even while a read is in flight", async () => {
      setup();
      const load = deferred();
      const write = deferred();
      act(() => {
        void api.track(() => load.promise, undefined, { read: true });
        void api.track(() => write.promise);
      });
      await advance(399);
      expect(chipText()).toContain("Saved");
      await advance(1);
      expect(chipText()).toContain("Saving…");
      await act(async () => {
        load.resolve("a");
      });
      expect(chipText()).toContain("Saving…");
      await act(async () => {
        write.resolve("b");
      });
      expect(chipText()).toContain("Saved");
    });

    it("a failed read shows the Error state, and Retry re-runs the read and delivers its result", async () => {
      setup();
      const onSuccess = vi.fn();
      const read = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("fresh");
      await act(async () => {
        await api.track(read, onSuccess, { read: true }).catch(() => {});
      });
      expect(chipText()).toContain("Couldn't save · Retry");
      expect(onSuccess).not.toHaveBeenCalled();
      await act(async () => {
        api.retry();
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledWith("fresh");
      expect(chipText()).toContain("Saved");
    });

    it("a successful read does not clear a failed save, which stays until a save succeeds", async () => {
      setup();
      await act(async () => {
        await api.track(() => Promise.reject(new Error("x"))).catch(() => {});
      });
      await act(async () => {
        await api.track(() => Promise.resolve("read"), undefined, { read: true });
      });
      expect(chipText()).toContain("Couldn't save");
      await act(async () => {
        await api.track(() => Promise.resolve("saved"));
      });
      expect(chipText()).toContain("Saved");
    });

    it("does not show Saving for a read made while a failed save is still showing Error", async () => {
      setup();
      await act(async () => {
        await api.track(() => Promise.reject(new Error("x"))).catch(() => {});
      });
      const load = deferred();
      act(() => {
        void api.track(() => load.promise, undefined, { read: true });
      });
      await advance(SAVING_DELAY_MS * 3);
      expect(chipText()).toContain("Couldn't save");
      await act(async () => {
        load.resolve("x");
      });
    });
  });

  it("stays Saving until every overlapping write has finished", async () => {
    setup();
    const a = deferred();
    const b = deferred();
    act(() => {
      void api.track(() => a.promise);
      void api.track(() => b.promise);
    });
    await advance(SAVING_DELAY_MS);
    expect(chipText()).toContain("Saving…");
    await act(async () => {
      a.resolve("a");
    });
    expect(chipText()).toContain("Saving…");
    await act(async () => {
      b.resolve("b");
    });
    expect(chipText()).toContain("Saved");
  });

  it("clears its pending timer when unmounted", async () => {
    const view = setup();
    act(() => {
      void api.track(() => new Promise(() => {}));
    });
    view.unmount();
    await advance(SAVING_DELAY_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
