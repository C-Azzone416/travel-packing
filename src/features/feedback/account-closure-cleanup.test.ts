import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryIdb } from "@/test/fake-feedback-server";
import { accountDatabaseName } from "./account-scope";
import {
  clearLocalFeedbackAfterAccountClosure,
  forgetClosingOutbox,
  rememberClosingOutbox,
  registerAccountClosureFeedbackCleanup,
  type AccountClosureFeedbackCleanupDependencies,
} from "./account-closure-cleanup";

const A = "A".repeat(43);
const B = "B".repeat(43);
let unregister: () => void = () => undefined;

afterEach(() => {
  unregister();
  unregister = () => undefined;
});

function setup(names: string[] = []) {
  const idb = createMemoryIdb(names);
  const dependencies: AccountClosureFeedbackCleanupDependencies = {
    enabled: () => true,
    indexedDB: () => idb.factory,
  };
  return { dependencies, idb };
}

describe("confirmed account-closure feedback cleanup", () => {
  it("stops and clears the mounted account before sweeping every account and legacy outbox", async () => {
    const { dependencies, idb } = setup([
      accountDatabaseName(A),
      accountDatabaseName(B),
      "framebriar-enrollment-v2-old",
      "framebriar-v1-outbox-old",
      "unrelated",
    ]);
    const mounted = vi.fn(async () => undefined);
    unregister = registerAccountClosureFeedbackCleanup(mounted);

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect(mounted).toHaveBeenCalledOnce();
    expect([...idb.present]).toEqual(["unrelated"]);
  });

  it("cold-starts by sweeping storage when no mounted provider is available", async () => {
    const { dependencies, idb } = setup([accountDatabaseName(A), "framebriar-enrollment-v1-old"]);

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect([...idb.present]).toEqual([]);
  });

  it("still sweeps storage when mounted cleanup fails", async () => {
    const { dependencies, idb } = setup([accountDatabaseName(A)]);
    unregister = registerAccountClosureFeedbackCleanup(async () => {
      throw new Error("synthetic clear failure");
    });

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect([...idb.present]).toEqual([]);
  });

  it("does nothing when IndexedDB is unavailable", async () => {
    const mounted = vi.fn(async () => undefined);
    unregister = registerAccountClosureFeedbackCleanup(mounted);
    await clearLocalFeedbackAfterAccountClosure({ enabled: () => true, indexedDB: () => null });
    expect(mounted).toHaveBeenCalledOnce();
  });

  it("does not touch feedback state outside an approved feedback runtime", async () => {
    const { dependencies, idb } = setup([accountDatabaseName(A)]);
    const mounted = vi.fn(async () => undefined);
    unregister = registerAccountClosureFeedbackCleanup(mounted);
    dependencies.enabled = () => false;

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect(mounted).not.toHaveBeenCalled();
    expect([...idb.present]).toEqual([accountDatabaseName(A)]);
  });

  describe("only the closing account's outbox goes (#261)", () => {
    afterEach(() => forgetClosingOutbox());

    it("deletes exactly the remembered account's database and leaves another account's unsent work", async () => {
      const { dependencies, idb } = setup([
        accountDatabaseName(A),
        accountDatabaseName(B),
        "framebriar-enrollment-v2-old",
        "unrelated",
      ]);
      rememberClosingOutbox(A);
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      expect([...idb.present].sort()).toEqual([accountDatabaseName(B), "unrelated"].sort());
    });

    it("is used once: a later cleanup with nothing remembered clears every account outbox again", async () => {
      const { dependencies, idb } = setup([accountDatabaseName(A), accountDatabaseName(B)]);
      rememberClosingOutbox(A);
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      expect([...idb.present]).toEqual([]);
    });

    it("an attempt that did not end in closure is forgotten, so nothing narrower than before is promised", async () => {
      const { dependencies, idb } = setup([accountDatabaseName(A), accountDatabaseName(B)]);
      rememberClosingOutbox(A);
      forgetClosingOutbox();
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      expect([...idb.present]).toEqual([]);
    });

    it("something that is not an outbox key clears every account outbox rather than leave work behind", async () => {
      const { dependencies, idb } = setup([accountDatabaseName(A), accountDatabaseName(B)]);
      rememberClosingOutbox("../../not-a-key");
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      expect([...idb.present]).toEqual([]);
    });

    it("still stops and clears the mounted account first", async () => {
      const { dependencies } = setup([accountDatabaseName(A)]);
      const mounted = vi.fn(async () => undefined);
      unregister = registerAccountClosureFeedbackCleanup(mounted);
      rememberClosingOutbox(A);
      await clearLocalFeedbackAfterAccountClosure(dependencies);
      expect(mounted).toHaveBeenCalledOnce();
    });
  });
});
