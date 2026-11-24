// @vitest-environment jsdom
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Nav } from "@/components/shell/Nav";
import { ToastProvider } from "@/components/ui/Toast";
import { createFakeFeedbackServer, createMemoryIdb } from "@/test/fake-feedback-server";
import { createFakeOutbox, OUTBOX_STATUS } from "@/test/fake-outbox";
import { FeedbackAccessProvider, useFeedbackAccess } from "./FeedbackAccess";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips" }));

type Callback = (...args: unknown[]) => unknown;
type Scheduler = {
  unstable_scheduleCallback: (
    priority: number,
    callback: Callback,
    ...options: unknown[]
  ) => unknown;
};
const require = createRequire(import.meta.url);
const scheduler = require("scheduler") as Scheduler;
const schedule = scheduler.unstable_scheduleCallback;
const clientPath = require.resolve("react-dom/client");
const implementationPath = join(dirname(clientPath), "cjs/react-dom-client.development.js");
const originalModules = [clientPath, implementationPath].map((path) => require.cache[path]);

function expectRestored() {
  expect(scheduler.unstable_scheduleCallback).toBe(schedule);
  for (const [index, path] of [clientPath, implementationPath].entries()) {
    expect(require.cache[path]).toBe(originalModules[index]);
  }
}

// Shared setup has already imported ReactDOM. Load ONE local renderer while it captures our
// Scheduler, then restore the exact original cache entries/export synchronously in finally.
// Existing Testing Library roots and other files keep their original renderer and Scheduler.
// No React/component module is reset, and no guard, dialog or action is mocked.
function localRenderer(intercept: Scheduler["unstable_scheduleCallback"], fail = false) {
  try {
    scheduler.unstable_scheduleCallback = intercept;
    delete require.cache[clientPath];
    delete require.cache[implementationPath];
    const client = require("react-dom/client") as { createRoot: typeof createRoot };
    if (fail) throw new Error("local renderer setup failed");
    return client;
  } finally {
    scheduler.unstable_scheduleCallback = schedule;
    for (const [index, path] of [clientPath, implementationPath].entries()) {
      const original = originalModules[index];
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  }
}

function heldRender() {
  let submits = 0;
  let holding = true;
  const pending: {
    priority: number;
    callback: Callback;
    options: unknown[];
    placeholder: Callback;
  }[] = [];
  const released: typeof pending = [];
  const client = localRenderer((priority, callback, ...options) => {
    if (holding && submits === 2 && callback.name === "bound performWorkOnRootViaSchedulerTask") {
      const placeholder = () => null;
      pending.push({ priority, callback, options, placeholder });
      // The task handle is a placeholder. The actual React callback/options are retained,
      // and only those original values are scheduled on release.
      return schedule(priority, placeholder, ...options);
    }
    return schedule(priority, callback, ...options);
  });
  const onSubmit = () => submits++;
  document.addEventListener("submit", onSubmit, true);
  return {
    client,
    pending,
    released,
    get submits() {
      return submits;
    },
    release() {
      holding = false;
      for (const task of pending.splice(0)) {
        released.push(task);
        schedule(task.priority, task.callback, ...task.options);
      }
    },
    dispose() {
      this.release();
      document.removeEventListener("submit", onSubmit, true);
    },
  };
}

function AccountStatus() {
  const { scopeKey, status, outbox } = useFeedbackAccess();
  return <output data-testid="account">{JSON.stringify({ scopeKey, status, outbox })}</output>;
}

it("keeps the account safe while the second native submit render is held and after its real commit", async () => {
  const hold = heldRender();
  expectRestored();
  const container = document.createElement("div");
  document.body.append(container);
  const root = hold.client.createRoot(container);
  const outbox = createFakeOutbox();
  const server = createFakeFeedbackServer({ status: "connected" });
  const idb = createMemoryIdb();
  const order: string[] = [];
  outbox.box.clear.mockImplementation(async () => {
    order.push("clear");
    return OUTBOX_STATUS;
  });
  const signOut = vi.fn(async () => {
    order.push("signOut");
  });
  const user = userEvent.setup();
  let observer: MutationObserver | undefined;
  try {
    await act(async () => {
      root.render(
        <ToastProvider>
          <FeedbackAccessProvider
            enabled
            fetchImpl={server.fetch}
            createOutbox={outbox.create}
            indexedDBImpl={idb.factory}
            preload={async () => undefined}
            createChannel={() => null}
          >
            <Nav signOut={signOut} email="someone@example.test" />
            <AccountStatus />
          </FeedbackAccessProvider>
        </ToastProvider>,
      );
    });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalledTimes(1));
    await outbox.status({ items: 3, blocked: 0 });
    outbox.box.status = () => ({ ...OUTBOX_STATUS, items: 2, blocked: 0 });
    outbox.box.start.mockImplementation(async () => {
      await outbox.created[0].send({ report: {}, media: null } as never).catch(() => undefined);
    });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Send now" }));
    await outbox.status({ items: 2, blocked: 0 });
    await screen.findByRole("button", { name: "Try again" });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain(
      "Some reports couldn’t be sent yet. They’re still on this device.",
    );
    const accountKey = outbox.created[0].outboxKey;
    const account = screen.getByTestId("account").textContent;
    const deleted = [...idb.deleted];
    function assertSafe() {
      expect(outbox.box.clear).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(order).toEqual([]);
      expect(outbox.created.map(({ outboxKey }) => outboxKey)).toEqual([accountKey]);
      expect(server.state.outboxKey).toBe(accountKey);
      expect(server.state.session).toBe("in");
      expect(idb.deleted).toEqual(deleted);
      expect(screen.getByTestId("account").textContent).toBe(account);
      expect(outbox.box.status()).toEqual({ ...OUTBOX_STATUS, items: 2, blocked: 0 });
      expect(outbox.box.start).toHaveBeenCalledTimes(2);
    }
    assertSafe();
    await user.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    assertSafe();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    // This is the real scheduled-render signal, not elapsed time or a modal mock.
    expect(hold.submits).toBe(2);
    expect(hold.pending).toHaveLength(1);
    const task = hold.pending[0];
    expect(task.priority).toBe(3);
    expect(task.callback.name).toBe("bound performWorkOnRootViaSchedulerTask");
    expect(task.callback).not.toBe(task.placeholder);
    expect(screen.queryByRole("dialog")).toBeNull();
    assertSafe();
    expectRestored();

    // Observe the actual portal commit before releasing the original callback/options.
    const committed = new Promise<void>((resolve) => {
      observer = new MutationObserver(() => {
        if (screen.queryByRole("dialog")) resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    hold.release();
    await committed;
    observer?.disconnect();
    expect(hold.pending).toHaveLength(0);
    expect(hold.released).toEqual([task]);
    expect(hold.released[0].callback).toBe(task.callback);
    expect(hold.released[0].options).toBe(task.options);
    assertSafe();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dialog = screen.getByRole("dialog", { name: "Feedback hasn’t sent yet" });
    expect(
      within(dialog).getByText(
        "2 reports haven’t sent yet. Signing out deletes them from this device.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toBe("");
  } finally {
    observer?.disconnect();
    hold.dispose();
    await act(async () => root.unmount());
    container.remove();
    expectRestored();
  }
});

it("restores the scheduler and module boundary on setup failure for ordinary rendering", () => {
  const intercept = vi.fn(schedule);
  expect(() => localRenderer(intercept, true)).toThrow("local renderer setup failed");
  expectRestored();
  render(<button>Original renderer still works</button>);
  expect(screen.getByRole("button", { name: "Original renderer still works" })).toBeTruthy();
  expect(intercept).not.toHaveBeenCalled();
});
