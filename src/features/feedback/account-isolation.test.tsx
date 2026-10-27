// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Nav } from "@/components/shell/Nav";
import { ToastProvider } from "@/components/ui/Toast";
import {
  createFakeFeedbackServer,
  createMemoryIdb,
  OUTBOX_KEY_A,
  OUTBOX_KEY_B,
} from "@/test/fake-feedback-server";
import { createFakeOutbox, type FakeOutbox } from "@/test/fake-outbox";
import { accountDatabaseName } from "./account-scope";
import { clearLocalFeedbackAfterAccountClosure } from "./account-closure-cleanup";
import {
  FeedbackAccessProvider,
  SIGN_OUT_CLEAR_LIMIT_MS,
  type AccountChannel,
  type CreateOutbox,
} from "./FeedbackAccess";
import { FeedbackButton } from "./FeedbackButton";
import { COPY } from "./FeedbackSheet";
import { FeedbackSettings } from "./FeedbackSettings";

let pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/features/feedback/screenshot-capture", () => ({
  screenshotCaptureAvailable: false,
  captureScreenshot: async () => null,
}));

/** One fake outbox per account key, the way the real one is one database per account. */
function outboxesByKey() {
  const boxes = new Map<string, FakeOutbox>();
  const create: CreateOutbox = vi.fn(async (options) => {
    let box = boxes.get(options.outboxKey);
    if (!box) {
      box = createFakeOutbox();
      boxes.set(options.outboxKey, box);
    }
    return box.create(options);
  });
  return { boxes, create };
}

function channelStub() {
  const channel: AccountChannel & { posted: string[]; closed: boolean } = {
    posted: [],
    closed: false,
    onmessage: null,
    postMessage(message) {
      this.posted.push(message);
    },
    close() {
      this.closed = true;
    },
  };
  return channel;
}

function mount(
  options: {
    server?: ReturnType<typeof createFakeFeedbackServer>;
    create?: CreateOutbox;
    idb?: ReturnType<typeof createMemoryIdb>;
    channel?: AccountChannel | null;
    ui?: React.ReactNode;
  } = {},
) {
  const server = options.server ?? createFakeFeedbackServer({ status: "connected" });
  const idb = options.idb ?? createMemoryIdb();
  const outboxes = outboxesByKey();
  const view = render(
    <ToastProvider>
      <FeedbackAccessProvider
        enabled
        fetchImpl={server.fetch}
        createOutbox={options.create ?? outboxes.create}
        indexedDBImpl={idb.factory}
        preload={async () => undefined}
        createChannel={() => options.channel ?? null}
      >
        {options.ui ?? <FeedbackButton />}
      </FeedbackAccessProvider>
    </ToastProvider>,
  );
  return { ...view, server, idb, outboxes };
}

const pageshow = () => act(async () => void window.dispatchEvent(new Event("pageshow")));

beforeEach(() => {
  pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11";
});
afterEach(() => vi.restoreAllMocks());

describe("one browser, several accounts: the outbox is named by the account", () => {
  it("on load keeps this account's database and deletes every other account's, and the #137 leftovers once", async () => {
    const idb = createMemoryIdb([
      accountDatabaseName(OUTBOX_KEY_A),
      accountDatabaseName(OUTBOX_KEY_B),
      "framebriar-enrollment-v2-https%3A%2F%2Fx-travel-packing",
      "framebriar-v1-outbox-v2-https%3A%2F%2Fx-travel-packing",
      "something-else",
    ]);
    const { outboxes } = mount({ idb });
    await waitFor(() => expect(outboxes.create).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect([...idb.present].sort()).toEqual(
        [accountDatabaseName(OUTBOX_KEY_A), "something-else"].sort(),
      ),
    );
  });

  it("names the outbox only with the server's key", async () => {
    const { outboxes } = mount();
    await waitFor(() => expect(outboxes.boxes.size).toBe(1));
    expect([...outboxes.boxes.keys()]).toEqual([OUTBOX_KEY_A]);
    expect(outboxes.boxes.get(OUTBOX_KEY_A)!.created[0].outboxKey).toBe(OUTBOX_KEY_A);
  });

  it("an account switch in the page stops the first account's outbox, opens the second's, and deletes the first's database", async () => {
    const idb = createMemoryIdb([accountDatabaseName(OUTBOX_KEY_A)]);
    const { server, outboxes } = mount({ idb });
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_A)?.box.start).toHaveBeenCalled());
    server.state.outboxKey = OUTBOX_KEY_B;
    idb.add(accountDatabaseName(OUTBOX_KEY_B));
    await pageshow();
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_B)?.box.start).toHaveBeenCalled());
    expect(outboxes.boxes.get(OUTBOX_KEY_A)!.box.stop).toHaveBeenCalled();
    await waitFor(() => expect(idb.present.has(accountDatabaseName(OUTBOX_KEY_A))).toBe(false));
    expect(idb.present.has(accountDatabaseName(OUTBOX_KEY_B))).toBe(true);
  });

  it("the second account never sees the first account's counts, receipts or open sheet", async () => {
    const user = userEvent.setup();
    const server = createFakeFeedbackServer({ status: "connected" });
    const { outboxes } = mount({
      server,
      ui: (
        <>
          <FeedbackButton />
          <FeedbackSettings />
        </>
      ),
    });
    const a = await waitFor(() => {
      const box = outboxes.boxes.get(OUTBOX_KEY_A);
      if (!box) throw new Error("no outbox yet");
      return box;
    });
    await waitFor(() => expect(a.box.subscribe).toHaveBeenCalled());
    a.status({ items: 2, blocked: 1 });
    expect(await screen.findByText("2 reports waiting to send on this device.")).toBeTruthy();

    // A's notes are typed into the open sheet...
    await user.click(await screen.findByRole("button", { name: "Send feedback" }));
    const dialog = await screen.findByRole("dialog", { name: "Send feedback" });
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "A's private notes");

    // ...then someone else is signed in to this page (another tab): none of it follows.
    server.state.outboxKey = OUTBOX_KEY_B;
    await pageshow();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send feedback" })).toBeNull());
    expect(document.body.textContent).not.toContain("A's private notes");
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_B)).toBeDefined());
    await waitFor(() =>
      expect(screen.queryByText("2 reports waiting to send on this device.")).toBeNull(),
    );
    expect(screen.queryByText(/couldn’t be delivered/)).toBeNull();
    // A late status from A's outbox is not shown for B.
    a.status({ items: 9, blocked: 9 });
    expect(screen.queryByText(/9 reports waiting/)).toBeNull();
    // B can open a fresh, empty sheet.
    await user.click(await screen.findByRole("button", { name: "Send feedback" }));
    const second = await screen.findByRole("dialog", { name: "Send feedback" });
    expect((within(second).getByLabelText(COPY.notesLabel) as HTMLTextAreaElement).value).toBe("");
  });

  it("a save always goes to the current account's outbox", async () => {
    const user = userEvent.setup();
    const server = createFakeFeedbackServer({ status: "connected" });
    const { outboxes } = mount({ server });
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_A)?.box.start).toHaveBeenCalled());
    server.state.outboxKey = OUTBOX_KEY_B;
    await pageshow();
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_B)?.box.start).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "Send feedback" }));
    const dialog = await screen.findByRole("dialog", { name: "Send feedback" });
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "for B");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outboxes.boxes.get(OUTBOX_KEY_B)!.box.enqueue).toHaveBeenCalledTimes(1);
    expect(outboxes.boxes.get(OUTBOX_KEY_A)!.box.enqueue).not.toHaveBeenCalled();
  });

  it("with no key from the server (it cannot name one) there is no outbox, nothing can be saved, and the button is off", async () => {
    const server = createFakeFeedbackServer({ status: "unavailable", outboxKey: null });
    const { outboxes } = mount({ server });
    const button = await screen.findByRole("button", { name: "Send feedback" });
    await waitFor(() => expect(server.count("status")).toBe(1));
    expect(button).toHaveProperty("disabled", true);
    expect(outboxes.create).not.toHaveBeenCalled();
  });
});

describe("a session that has ended", () => {
  it("hides feedback, stops the outbox and sends nothing", async () => {
    const server = createFakeFeedbackServer({ status: "connected" });
    const { outboxes } = mount({
      server,
      ui: (
        <>
          <FeedbackButton />
          <FeedbackSettings />
        </>
      ),
    });
    await waitFor(() => expect(outboxes.boxes.get(OUTBOX_KEY_A)?.box.start).toHaveBeenCalled());
    server.state.session = "out";
    await pageshow();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull());
    expect(screen.queryByRole("heading", { name: "Send feedback to the developer" })).toBeNull();
    expect(outboxes.boxes.get(OUTBOX_KEY_A)!.box.stop).toHaveBeenCalled();
    expect(server.count("reports")).toBe(0);
    expect(server.delivered).toEqual([]);
  });

  it("a session that is not allowed (403) is the same", async () => {
    const server = createFakeFeedbackServer({ status: "connected", session: "forbidden" });
    mount({ server });
    await waitFor(() => expect(server.count("status")).toBe(1));
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});

describe("confirmed account closure", () => {
  it("stops the mounted queue, clears every local account outbox and never calls the enrollment API", async () => {
    const server = createFakeFeedbackServer({ status: "connected" });
    const idb = createMemoryIdb([
      accountDatabaseName(OUTBOX_KEY_A),
      accountDatabaseName(OUTBOX_KEY_B),
      "framebriar-enrollment-v2-old",
    ]);
    const channel = channelStub();
    const { outboxes } = mount({ server, idb, channel });
    const current = await waitFor(() => {
      const box = outboxes.boxes.get(OUTBOX_KEY_A);
      if (!box) throw new Error("no outbox");
      return box;
    });
    await waitFor(() => expect(current.box.start).toHaveBeenCalled());
    const calls = server.calls.length;

    await clearLocalFeedbackAfterAccountClosure({
      enabled: () => true,
      indexedDB: () => idb.factory,
    });

    expect(current.box.stop).toHaveBeenCalled();
    expect(current.box.clear).toHaveBeenCalledOnce();
    expect([...idb.present]).toEqual([]);
    expect(channel.posted).toEqual(["account-ended"]);
    expect(server.count("disconnect")).toBe(0);
    expect(server.count("reports")).toBe(0);
    expect(server.calls.length).toBe(calls);
  });
});

describe("sign-out", () => {
  const nav = (signOut: () => Promise<void>) => (
    <Nav signOut={signOut} email="someone@example.test" />
  );

  it("clears this account's unsent feedback from the device BEFORE the session ends, and does not disconnect the server enrollment", async () => {
    const order: string[] = [];
    const server = createFakeFeedbackServer({ status: "connected" });
    const idb = createMemoryIdb([accountDatabaseName(OUTBOX_KEY_A)]);
    const channel = channelStub();
    const signOut = vi.fn(async () => {
      order.push("signOut");
    });
    const { outboxes } = mount({ server, idb, channel, ui: nav(signOut) });
    const a = await waitFor(() => {
      const box = outboxes.boxes.get(OUTBOX_KEY_A);
      if (!box) throw new Error("no outbox");
      return box;
    });
    await waitFor(() => expect(a.box.start).toHaveBeenCalled());
    a.box.clear.mockImplementation(async () => {
      order.push("cleared");
      return (await import("@/test/fake-outbox")).OUTBOX_STATUS;
    });
    const calls = server.calls.length;

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["cleared", "signOut"]);
    expect(a.box.stop).toHaveBeenCalled();
    expect(idb.present.has(accountDatabaseName(OUTBOX_KEY_A))).toBe(false);
    expect(channel.posted).toEqual(["account-ended"]);
    // The enrollment on the server stays: nothing was disconnected, redeemed or sent while signing out.
    expect(server.count("disconnect")).toBe(0);
    expect(server.count("redeem")).toBe(0);
    expect(server.count("reports")).toBe(0);
    expect(server.calls.length).toBe(calls);
  });

  it("does not wait forever for a database that will not clear", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const signOut = vi.fn(async () => undefined);
      const { outboxes } = mount({ ui: nav(signOut) });
      const a = await waitFor(() => {
        const box = outboxes.boxes.get(OUTBOX_KEY_A);
        if (!box) throw new Error("no outbox");
        return box;
      });
      await waitFor(() => expect(a.box.start).toHaveBeenCalled());
      a.box.clear.mockImplementation(() => new Promise(() => undefined));
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await act(async () => vi.advanceTimersByTimeAsync(SIGN_OUT_CLEAR_LIMIT_MS - 100));
      expect(signOut).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(300));
      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs out normally where feedback is not on (no clearing, nothing to clear)", async () => {
    const signOut = vi.fn(async () => undefined);
    render(<Nav signOut={signOut} email="someone@example.test" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("signs out even when there is no outbox yet", async () => {
    const signOut = vi.fn(async () => undefined);
    mount({
      server: createFakeFeedbackServer({ status: "unavailable", outboxKey: null }),
      ui: nav(signOut),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("other tabs", () => {
  it("look again when another tab ends or switches the account, and the channel is closed on unmount", async () => {
    const channel = channelStub();
    const view = mount({ channel });
    await waitFor(() => expect(view.server.count("status")).toBe(1));
    act(() => channel.onmessage?.({ data: "account-ended" } as MessageEvent));
    await waitFor(() => expect(view.server.count("status")).toBe(2));
    view.unmount();
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
  });
});

describe("it never acts on its own", () => {
  it("asks the server for the status and nothing else, however long it runs and whatever the state", async () => {
    for (const status of [
      "not-connected",
      "expired",
      "revoked",
      "disabled",
      "unavailable",
      "connected",
    ] as const) {
      const server = createFakeFeedbackServer({
        status,
        redemption: status === "not-connected" ? "pending" : "none",
      });
      const view = mount({ server });
      await waitFor(() => expect(server.count("status")).toBe(1));
      await pageshow();
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(new Set(server.calls.map((call) => call.route))).toEqual(new Set(["status"]));
      expect(server.invitations).toEqual([]);
      expect(server.delivered).toEqual([]);
      view.unmount();
    }
  });
});
