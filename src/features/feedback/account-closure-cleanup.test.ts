import { afterEach, describe, expect, it, vi } from "vitest";
import type { DurableFeedback } from "@masra91/framebriar/browser/durable-feedback";
import type { PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import {
  clearLocalFeedbackAfterAccountClosure,
  registerAccountClosureFeedbackCleanup,
  type AccountClosureFeedbackCleanupDependencies,
} from "./account-closure-cleanup";

let unregister: () => void = () => undefined;
afterEach(() => unregister());

function setup(
  options: { clearFails?: boolean; createOutboxFails?: boolean; disconnectFails?: boolean } = {},
) {
  const order: string[] = [];
  const outbox = {
    stop: vi.fn(() => order.push("stop")),
    clear: vi.fn(async () => {
      order.push("clear");
      if (options.clearFails) throw new Error("synthetic clear failure");
      return {};
    }),
  } as unknown as DurableFeedback;
  const access = {
    disconnect: vi.fn(async () => {
      order.push("disconnect");
      if (options.disconnectFails) throw new Error("synthetic disconnect failure");
      return { forgotten: true, revoked: true };
    }),
    dispose: vi.fn(() => order.push("dispose")),
  } as unknown as PlaytestAccess;
  const dependencies: AccountClosureFeedbackCleanupDependencies = {
    enabled: () => true,
    createAccess: vi.fn(async () => access),
    createOutbox: vi.fn(async () => {
      if (options.createOutboxFails) throw new Error("synthetic outbox failure");
      return outbox;
    }),
  };
  return { access, dependencies, order, outbox };
}

describe("confirmed account-closure feedback cleanup", () => {
  it("uses the mounted controller to stop delivery before clearing and disconnecting", async () => {
    const { access, dependencies, order, outbox } = setup();
    unregister = registerAccountClosureFeedbackCleanup(async () => {
      outbox.stop();
      await outbox.clear();
      await access.disconnect();
    });

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect(order).toEqual(["stop", "clear", "disconnect"]);
    expect(dependencies.createAccess).not.toHaveBeenCalled();
  });

  it("cold-starts cleanup when no mounted controller is available", async () => {
    const { access, dependencies, order, outbox } = setup();

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect(order).toEqual(["stop", "clear", "disconnect", "stop", "dispose"]);
    expect(outbox.clear).toHaveBeenCalledOnce();
    expect(access.disconnect).toHaveBeenCalledOnce();
  });

  it("still forgets access and disposes when local outbox clearing fails", async () => {
    const { access, dependencies, order } = setup({ clearFails: true });

    await expect(clearLocalFeedbackAfterAccountClosure(dependencies)).rejects.toThrow(
      "synthetic clear failure",
    );

    expect(order).toEqual(["stop", "clear", "disconnect", "stop", "dispose"]);
    expect(access.disconnect).toHaveBeenCalledOnce();
  });

  it("still forgets access when loading the local outbox fails", async () => {
    const { access, dependencies, order } = setup({ createOutboxFails: true });

    await expect(clearLocalFeedbackAfterAccountClosure(dependencies)).rejects.toThrow(
      "synthetic outbox failure",
    );

    expect(order).toEqual(["disconnect", "dispose"]);
    expect(access.disconnect).toHaveBeenCalledOnce();
  });

  it("disposes after a disconnect failure", async () => {
    const { access, dependencies, order } = setup({ disconnectFails: true });

    await expect(clearLocalFeedbackAfterAccountClosure(dependencies)).rejects.toThrow(
      "synthetic disconnect failure",
    );

    expect(order).toEqual(["stop", "clear", "disconnect", "stop", "dispose"]);
    expect(access.dispose).toHaveBeenCalledOnce();
  });

  it("does not load the SDK outside an approved feedback runtime", async () => {
    const { dependencies } = setup();
    dependencies.enabled = () => false;

    await clearLocalFeedbackAfterAccountClosure(dependencies);

    expect(dependencies.createAccess).not.toHaveBeenCalled();
    expect(dependencies.createOutbox).not.toHaveBeenCalled();
  });
});
