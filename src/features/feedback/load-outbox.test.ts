import { afterEach, describe, expect, it, vi } from "vitest";

// What the app builds the SDK's outbox with (#260): one queue per account, the app's own transport, and no token anywhere.
const sdk = vi.hoisted(() => ({
  durable: vi.fn((options: Record<string, unknown>) => ({ fake: "outbox", options })),
  queues: [] as { scope: string }[],
}));
vi.mock("@masra91/framebriar/browser/durable-feedback", () => ({
  createDurableFeedback: sdk.durable,
}));
vi.mock("@masra91/framebriar/browser/queue", () => ({
  OfflineQueue: class {
    constructor(public scope: string) {
      sdk.queues.push({ scope });
    }
  },
}));

import { loadOutbox } from "./FeedbackAccess";

afterEach(() => {
  vi.unstubAllGlobals();
  sdk.durable.mockClear();
  sdk.queues.length = 0;
});

const KEY = "K".repeat(43);

describe("loadOutbox", () => {
  it("returns null, so nothing is ever claimed saved, where the browser has no IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(
      await loadOutbox({ outboxKey: KEY, send: vi.fn() as never, onReceipt: vi.fn() }),
    ).toBeNull();
    expect(sdk.durable).not.toHaveBeenCalled();
  });

  it("builds the SDK outbox over a queue named by the account key, with the app's transport and no credential", async () => {
    vi.stubGlobal("indexedDB", {});
    const send = vi.fn();
    const onReceipt = vi.fn();
    await loadOutbox({ outboxKey: KEY, send: send as never, onReceipt });
    expect(sdk.queues).toEqual([{ scope: `acct-${KEY}` }]);
    expect(sdk.durable).toHaveBeenCalledTimes(1);
    const options = sdk.durable.mock.calls[0][0] as Record<string, unknown> & {
      getToken: () => Promise<unknown>;
      queue: { scope: string };
      endpoint: string;
    };
    expect(options.queue.scope).toBe(`acct-${KEY}`);
    expect(options.send).toBe(send);
    expect(options.onReceipt).toBe(onReceipt);
    expect(options.gameId).toBe("travel-packing");
    // The SDK insists on an HTTPS endpoint with no credentials, but the injected transport never uses it, and there is no token to give.
    expect(new URL(options.endpoint).protocol).toBe("https:");
    expect(await options.getToken()).toBeUndefined();
  });

  it("refuses a key that is not the server's, so a database name cannot be forged", async () => {
    vi.stubGlobal("indexedDB", {});
    await expect(
      loadOutbox({ outboxKey: "../../x", send: vi.fn() as never, onReceipt: vi.fn() }),
    ).rejects.toThrow();
    expect(sdk.durable).not.toHaveBeenCalled();
  });
});
