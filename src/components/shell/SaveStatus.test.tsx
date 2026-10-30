// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedSaveChip,
  SAVED_CONFIRMATION_MS,
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

const chipText = () => document.querySelector(".sync-chip")?.textContent ?? "";
const hasChip = () => document.querySelector(".sync-chip") !== null;
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

  it("starts quiet without claiming or announcing a save", () => {
    setup();
    expect(hasChip()).toBe(false);
    expect(status()).toBe("");
    expect(alertText()).toBe("");
  });

  it("never flashes Saving for a quick write, then confirms Saved for a bounded time", async () => {
    setup();
    const write = deferred();
    let result: Promise<string>;
    act(() => {
      result = api.track(() => write.promise);
    });
    await advance(SAVING_DELAY_MS - 1);
    expect(hasChip()).toBe(false);
    await act(async () => {
      write.resolve("ok");
      await result;
    });
    expect(chipText()).toContain("Saved");
    await advance(SAVED_CONFIRMATION_MS - 1);
    expect(chipText()).toContain("Saved");
    await advance(1);
    expect(hasChip()).toBe(false);
    expect(status()).toBe("");
  });

  it("shows Saving only after 400ms, announces success, then returns to quiet idle", async () => {
    setup();
    expect(SAVING_DELAY_MS).toBe(400);
    expect(SAVED_CONFIRMATION_MS).toBe(2_000);
    const write = deferred();
    let result: Promise<string>;
    act(() => {
      result = api.track(() => write.promise);
    });
    await advance(399);
    expect(hasChip()).toBe(false);
    await advance(1);
    expect(chipText()).toContain("Saving…");
    expect(status()).toBe("Saving");
    await act(async () => {
      write.resolve("ok");
      await expect(result).resolves.toBe("ok");
    });
    expect(chipText()).toContain("Saved");
    expect(status()).toBe("Saved");
    await advance(SAVED_CONFIRMATION_MS);
    expect(hasChip()).toBe(false);
    expect(status()).toBe("");
  });

  it("goes straight to Error on failure, rethrows, and announces assertively", async () => {
    setup();
    await act(async () => {
      await expect(api.track(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    });
    expect(chipText()).toContain("Not saved · Retry");
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
    expect(chipText()).toContain("Not saved");
    await act(async () => {
      write.resolve("ok");
    });
    expect(chipText()).toContain("Saved");
  });

  it("shows Saving for a later slow write after a failed write has recovered", async () => {
    setup();
    await act(async () => {
      await api.track(() => Promise.reject(new Error("boom"))).catch(() => {});
    });
    expect(chipText()).toContain("Not saved");
    await act(async () => {
      await api.track(() => Promise.resolve("recovered"));
    });
    expect(chipText()).toContain("Saved");

    const slow = deferred();
    act(() => {
      void api.track(() => slow.promise);
    });
    await advance(SAVING_DELAY_MS);
    expect(chipText()).toContain("Saving…");
    await act(async () => {
      slow.resolve("later");
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
    expect(chipText()).toContain("Not saved");
    write.mockResolvedValue("ok");
    await act(async () => {
      api.retry();
    });
    expect(write).toHaveBeenCalledTimes(3);
    expect(chipText()).toContain("Saved");
  });

  it("the error chip opens a sheet; Retry retries and Dismiss leaves the Error state", async () => {
    setup();
    const write = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("ok");
    await act(async () => {
      await api.track(write).catch(() => {});
    });
    await act(async () => {
      (document.querySelector("button.sync-chip") as HTMLButtonElement).click();
    });
    // Tapping the chip does not retry by itself: it explains first.
    expect(write).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "Couldn’t save" });
    expect(
      within(dialog).getByText("Your change is still on screen. Retry to save it."),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/hasn’t been saved|We’ll keep it on screen/)).toBeNull();
    await act(async () => {
      within(dialog).getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chipText()).toContain("Not saved");
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      (document.querySelector("button.sync-chip") as HTMLButtonElement).click();
    });
    await act(async () => {
      within(screen.getByRole("dialog")).getByRole("button", { name: "Retry" }).click();
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(chipText()).toContain("Saved");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the sheet by itself when a newer save succeeds", async () => {
    setup();
    await act(async () => {
      await api.track(() => Promise.reject(new Error("x"))).catch(() => {});
    });
    await act(async () => {
      (document.querySelector("button.sync-chip") as HTMLButtonElement).click();
    });
    expect(screen.getByRole("dialog", { name: "Couldn’t save" })).toBeTruthy();
    await act(async () => {
      await api.track(async () => "ok");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remembers when the last write succeeded, ignores reads, and warns before leaving while in Error", async () => {
    setup();
    expect(api.lastSavedAt).toBeNull();
    await act(async () => {
      await api.track(async () => "loaded", undefined, { read: true });
    });
    expect(api.lastSavedAt).toBeNull();
    await act(async () => {
      await api.track(async () => "ok");
    });
    expect(api.lastSavedAt).toBeInstanceOf(Date);
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await act(async () => {
      await api.track(() => Promise.reject(new Error("x"))).catch(() => {});
    });
    expect(leave()).toBe(true);
    await act(async () => {
      await api.track(async () => "ok");
    });
    expect(leave()).toBe(false);
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
    expect(chipText()).toContain("Not saved");
    await advance(SAVING_DELAY_MS * 2);
    expect(chipText()).toContain("Not saved");
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
      expect(hasChip()).toBe(false);
      expect(chipText()).not.toContain("Saving");
      expect(status()).toBe("");
      await act(async () => {
        load.resolve("loaded");
        await result;
      });
      expect(onSuccess).toHaveBeenCalledWith("loaded");
      expect(hasChip()).toBe(false);
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
      expect(hasChip()).toBe(false);
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
      expect(chipText()).toContain("Not saved · Retry");
      expect(onSuccess).not.toHaveBeenCalled();
      await act(async () => {
        api.retry();
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledWith("fresh");
      expect(hasChip()).toBe(false);
    });

    it("a RETRIED read is still a read: it never shows Saving, and does not hold the chip after a save completes", async () => {
      setup();
      const load = deferred();
      const onSuccess = vi.fn();
      const read = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockImplementation(() => load.promise);
      await act(async () => {
        await api.track(read, onSuccess, { read: true }).catch(() => {});
      });
      expect(chipText()).toContain("Not saved");
      act(() => api.retry());
      await advance(SAVING_DELAY_MS * 5);
      expect(chipText()).not.toContain("Saving");
      expect(status()).not.toBe("Saving");
      // A save finishes while the slow retried load is still in flight: the load must not count as a
      // pending write, so the chip settles on Saved straight away.
      await act(async () => {
        await api.track(() => Promise.resolve("saved"));
      });
      expect(chipText()).toContain("Saved");
      expect(chipText()).not.toContain("Saving");
      await act(async () => {
        load.resolve("fresh");
      });
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
      expect(chipText()).toContain("Not saved");
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
      expect(chipText()).toContain("Not saved");
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

  it("keeps the Saving timer when one overlapping write finishes before the delay", async () => {
    setup();
    const first = deferred();
    const second = deferred();
    act(() => {
      void api.track(() => first.promise);
      void api.track(() => second.promise);
    });
    await advance(SAVING_DELAY_MS - 1);
    expect(hasChip()).toBe(false);
    await act(async () => {
      first.resolve("first");
    });
    expect(hasChip()).toBe(false);
    await advance(1);
    expect(chipText()).toContain("Saving…");
    await act(async () => {
      second.resolve("second");
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

  it("clears its saved-confirmation timer when unmounted", async () => {
    const view = setup();
    await act(async () => {
      await api.track(async () => "saved");
    });
    expect(chipText()).toContain("Saved");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stale Saved confirmation when another write starts", async () => {
    setup();
    await act(async () => {
      await api.track(async () => "first");
    });
    expect(chipText()).toContain("Saved");
    const next = deferred();
    act(() => {
      void api.track(() => next.promise);
    });
    expect(hasChip()).toBe(false);
    await advance(SAVING_DELAY_MS);
    expect(chipText()).toContain("Saving…");
    await advance(SAVED_CONFIRMATION_MS);
    expect(chipText()).toContain("Saving…");
    await act(async () => next.resolve("done"));
    expect(chipText()).toContain("Saved");
  });
});
