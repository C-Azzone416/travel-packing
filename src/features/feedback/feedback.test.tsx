// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import {
  createFakeFeedbackServer,
  createMemoryIdb,
  OUTBOX_KEY_A,
  type FakeFeedbackServer,
} from "@/test/fake-feedback-server";
import { createFakeOutbox, type FakeOutbox } from "@/test/fake-outbox";
import { accountDatabaseName } from "./account-scope";
import { feedbackBuildSha } from "./build-sha";
import { FeedbackAccessProvider } from "./FeedbackAccess";
import { FeedbackButton } from "./FeedbackButton";
import { FeedbackNotice } from "./FeedbackNotice";
import {
  connectFailureText,
  DISCONNECT_RESULT,
  expiryText,
  FeedbackSettings,
} from "./FeedbackSettings";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

interface Harness {
  server: FakeFeedbackServer;
  outbox: FakeOutbox;
  idb: ReturnType<typeof createMemoryIdb>;
}

function harness(initial: Parameters<typeof createFakeFeedbackServer>[0] = {}): Harness {
  return {
    server: createFakeFeedbackServer(initial),
    outbox: createFakeOutbox(),
    idb: createMemoryIdb(),
  };
}

function providerFor(h: Harness, ui: React.ReactNode) {
  return (
    <ToastProvider>
      <FeedbackAccessProvider
        enabled
        fetchImpl={h.server.fetch}
        createOutbox={h.outbox.create}
        indexedDBImpl={h.idb.factory}
        preload={async () => undefined}
        createChannel={() => null}
      >
        {ui}
      </FeedbackAccessProvider>
    </ToastProvider>
  );
}

function mount(h: Harness, ui: React.ReactNode = <FeedbackSettings />) {
  return render(providerFor(h, ui));
}

const alertEl = () =>
  waitFor(() => {
    const el = document.querySelector(".field-error");
    if (!el) throw new Error("no failure shown");
    return el;
  });

const connectedState = {
  status: "connected" as const,
  expiresAt: "2026-11-19T12:00:00.000Z",
};

beforeEach(() => {
  pathname = "/";
});
afterEach(() => vi.restoreAllMocks());

describe("feedbackBuildSha", () => {
  it("accepts 7 to 40 hex characters and turns everything else into null", () => {
    expect(feedbackBuildSha("ABCDEF1")).toBe("abcdef1");
    expect(feedbackBuildSha("a".repeat(40))).toBe("a".repeat(40));
    for (const bad of ["abc12", "a".repeat(41), "not-a-sha!", "", "  ", undefined, null]) {
      expect(feedbackBuildSha(bad)).toBeNull();
    }
  });
});

describe("expiryText", () => {
  it("formats the date and omits the line when there is none", () => {
    expect(expiryText("2026-11-19T12:00:00.000Z")).toBe("Feedback works until Nov 19, 2026.");
    expect(expiryText(null)).toBeNull();
    expect(expiryText("nonsense")).toBeNull();
  });
});

describe("connectFailureText", () => {
  it("says what is true for each failure, never suggesting the invitation is safe to reuse when it may be spent", () => {
    expect(connectFailureText({ kind: "invalid" })).toMatch(
      /didn’t work.*expired or already been used/,
    );
    expect(connectFailureText({ kind: "uncertain" })).toMatch(
      /may have been used.*same invitation again.*won’t be spent twice/,
    );
    expect(connectFailureText({ kind: "offline" })).toMatch(/offline/);
    expect(connectFailureText({ kind: "unavailable" })).toMatch(/isn’t available right now/);
    expect(connectFailureText({ kind: "rate-limited", retryAfterSeconds: 90 })).toBe(
      "Too many tries. Wait 90 seconds and try again.",
    );
    expect(connectFailureText({ kind: "rate-limited", retryAfterSeconds: 1 })).toBe(
      "Too many tries. Wait 1 second and try again.",
    );
    expect(connectFailureText({ kind: "rate-limited", retryAfterSeconds: null })).toBe(
      "Too many tries. Wait a little and try again.",
    );
  });
});

describe("the provider", () => {
  it("makes no request and shows no UI when the exact-origin runtime gate is closed", async () => {
    const h = harness();
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          enabled={false}
          fetchImpl={h.server.fetch}
          createOutbox={h.outbox.create}
        >
          <FeedbackSettings />
          <FeedbackButton />
          <FeedbackNotice />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await Promise.resolve();
    expect(h.server.calls).toEqual([]);
    expect(h.outbox.create).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Send feedback to the developer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
    expect(document.querySelector(".feedback-notice")).toBeNull();
  });

  it("asks the server once on load, names the outbox by the server's opaque key, and starts it", async () => {
    const h = harness(connectedState);
    mount(h);
    await waitFor(() => expect(h.outbox.create).toHaveBeenCalledTimes(1));
    expect(h.server.count("status")).toBe(1);
    expect(h.outbox.created[0].outboxKey).toBe(OUTBOX_KEY_A);
    await waitFor(() => expect(h.outbox.box.start).toHaveBeenCalled());
    // Nothing was redeemed, disconnected or sent just by looking.
    expect(h.server.calls.map((c) => c.route)).toEqual(["status"]);
  });

  it("stops the outbox on pagehide, starts it again on pageshow, and stops it on unmount", async () => {
    const h = harness(connectedState);
    const view = mount(h);
    await waitFor(() => expect(h.outbox.box.start).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("pagehide"));
    expect(h.outbox.box.stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pageshow"));
    expect(h.outbox.box.start).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(h.server.count("status")).toBe(2));
    view.unmount();
    expect(h.outbox.box.stop).toHaveBeenCalledTimes(2);
  });

  it("stops an outbox that arrives after unmount, and survives one that fails to build", async () => {
    const h = harness(connectedState);
    let release: (box: unknown) => void = () => undefined;
    const late = new Promise((resolve) => (release = resolve));
    const view = render(
      <FeedbackAccessProvider
        enabled
        fetchImpl={h.server.fetch}
        indexedDBImpl={h.idb.factory}
        createChannel={() => null}
        preload={async () => undefined}
        createOutbox={() => late as never}
      >
        <p>x</p>
      </FeedbackAccessProvider>,
    );
    await waitFor(() => expect(h.server.count("status")).toBe(1));
    view.unmount();
    const box = { stop: vi.fn() };
    release(box);
    await waitFor(() => expect(box.stop).toHaveBeenCalled());
    render(
      <FeedbackAccessProvider
        enabled
        fetchImpl={h.server.fetch}
        indexedDBImpl={h.idb.factory}
        createChannel={() => null}
        createOutbox={() => Promise.reject(new Error("no"))}
      >
        <p>fine</p>
      </FeedbackAccessProvider>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("says storage is unavailable when this browser cannot make an outbox, and saves nothing", async () => {
    const h = harness(connectedState);
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          enabled
          fetchImpl={h.server.fetch}
          indexedDBImpl={h.idb.factory}
          createChannel={() => null}
          preload={async () => undefined}
          createOutbox={async () => null}
        >
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText(/can’t keep reports on the device/)).toBeTruthy();
  });

  it("resumes delivery when the account becomes connected", async () => {
    const h = harness();
    mount(h);
    await waitFor(() => expect(h.outbox.box.start).toHaveBeenCalled());
    expect(h.outbox.box.resume).not.toHaveBeenCalled();
    h.server.state.status = "connected";
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(h.outbox.box.resume).toHaveBeenCalled());
  });
});

describe("Settings section: checking and the six server states", () => {
  it("says it is checking until the server has answered", async () => {
    const h = harness();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = (async (...args: Parameters<typeof fetch>) => {
      await held;
      return h.server.fetch(...args);
    }) as typeof fetch;
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          enabled
          fetchImpl={slow}
          createOutbox={h.outbox.create}
          indexedDBImpl={h.idb.factory}
          createChannel={() => null}
          preload={async () => undefined}
        >
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Checking your feedback access…")).toBeTruthy();
    expect(screen.queryByLabelText("Invitation")).toBeNull();
    release();
    expect(await screen.findByLabelText("Invitation")).toBeTruthy();
  });

  it.each([
    ["not-connected", null, true],
    ["expired", "Expired", true],
    ["revoked", "Ended", true],
    ["needs_reconnect", "Needs invitation", true],
    ["disabled", "Switched off", false],
    ["unavailable", "Unavailable", false],
  ] as const)("%s: badge %s, invitation form %s", async (status, badge, form) => {
    const h = harness({ status });
    mount(h);
    if (badge) expect(await screen.findByText(badge)).toBeTruthy();
    else await screen.findByRole("heading", { name: "Send feedback to the developer" });
    await waitFor(() => expect(h.server.count("status")).toBe(1));
    await waitFor(() => expect(Boolean(screen.queryByLabelText("Invitation"))).toBe(form));
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("connected: badge, expiry, Disconnect, and no form (a second redeem would only be refused)", async () => {
    mount(harness(connectedState));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByText("Feedback works until Nov 19, 2026.")).toBeTruthy();
    expect(screen.queryByLabelText("Invitation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use a new invitation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("omits the expiry when there is none", async () => {
    mount(harness({ status: "connected", expiresAt: null }));
    await screen.findByText("Connected");
    expect(screen.queryByText(/Feedback works until/)).toBeNull();
  });

  it("a pending redemption asks for the same invitation again and keeps the form", async () => {
    mount(harness({ redemption: "pending" }));
    expect(await screen.findByText("Not finished")).toBeTruthy();
    expect(screen.getByText(/Paste the same invitation again to finish/)).toBeTruthy();
    expect(screen.getByLabelText("Invitation")).toBeTruthy();
  });

  it("a server answer that is not understood is shown as unavailable, not as connected", async () => {
    const h = harness(connectedState);
    h.server.failNext("status", { kind: "malformed" });
    mount(h);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("offline: says so and that saved reports wait; keeps the last known connection", async () => {
    const h = harness(connectedState);
    mount(h);
    await screen.findByText("Connected");
    h.server.failNext("status", { kind: "network" });
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(
      await screen.findByText(/You’re offline\. Reports you save are kept on this device/),
    ).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    await act(async () => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(screen.queryByText(/You’re offline/)).toBeNull());
  });

  it("the browser's own offline signal is honoured without a request", async () => {
    mount(harness(connectedState));
    await screen.findByText("Connected");
    act(() => window.dispatchEvent(new Event("offline")));
    expect(await screen.findByText(/You’re offline/)).toBeTruthy();
  });

  it("a rate limit on a send says reports are waiting, then clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const h = harness(connectedState);
      mount(h);
      await screen.findByText("Connected");
      const send = h.outbox.created[0].send;
      h.server.failNext("reports", {
        kind: "status",
        status: 429,
        error: "RATE_LIMITED",
        retryAfterSeconds: 30,
      });
      await expect(
        send({ report: { id: "r", gameId: "travel-packing", media: null } as never, media: null }),
      ).rejects.toMatchObject({ code: "quota" });
      expect(await screen.findByText(/Feedback is limited for a moment/)).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(31_000));
      expect(screen.queryByText(/Feedback is limited for a moment/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a send the server refuses as 'not connected' refreshes the status at once", async () => {
    const h = harness(connectedState);
    mount(h);
    await screen.findByText("Connected");
    const send = h.outbox.created[0].send;
    h.server.state.status = "revoked";
    // The enrollment was ended elsewhere: the send learns it from the 409 (it is connected as far as this page knew).
    await expect(
      send({ report: { id: "r", gameId: "travel-packing", media: null } as never, media: null }),
    ).rejects.toMatchObject({ code: "access-required" });
    expect(await screen.findByText("Ended")).toBeTruthy();
  });
});

describe("Settings section: connecting", () => {
  it("shows the spec copy and an invitation field that is a password input", async () => {
    mount(harness());
    expect(
      await screen.findByRole("heading", { name: "Send feedback to the developer" }),
    ).toBeTruthy();
    const field = await screen.findByLabelText("Invitation");
    expect(field).toHaveProperty("type", "password");
    expect(field.parentElement?.classList.contains("field")).toBe(true);
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(
      screen.getByText(
        "Paste the invitation the developer sent you. It works once and isn’t stored.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Don’t include passwords, codes or personal details/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toHaveProperty("disabled", true);
  });

  it("never redeems by itself: only the Connect button does, and exactly once per press", async () => {
    const h = harness();
    mount(h);
    await screen.findByLabelText("Invitation");
    await act(async () => window.dispatchEvent(new Event("online")));
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(h.server.count("redeem")).toBe(0);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected. Feedback is on.");
    expect(h.server.count("redeem")).toBe(1);
  });

  it("clears the field the moment Connect is pressed, shows Connecting…, then toasts and shows Connected", async () => {
    const h = harness();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slowRedeem = (async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).endsWith("/redeem")) await held;
      return h.server.fetch(...args);
    }) as typeof fetch;
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          enabled
          fetchImpl={slowRedeem}
          createOutbox={h.outbox.create}
          indexedDBImpl={h.idb.factory}
          createChannel={() => null}
          preload={async () => undefined}
        >
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Invitation");
    await user.type(field, " inv-0123456789abcdef ");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(field).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Connecting…" })).toHaveProperty("disabled", true);
    await act(async () => release());
    expect(await screen.findByText("Connected. Feedback is on.")).toBeTruthy();
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(h.server.invitations).toEqual(["inv-0123456789abcdef"]);
    expect(document.body.textContent).not.toContain("inv-0123456789abcdef");
  });

  it.each([
    ["an invitation that does not work", { redeem: "rejected" as const }, undefined, /didn’t work/],
    [
      "a lost answer",
      { redeem: "uncertain" as const },
      undefined,
      /may have been used.*same invitation again/,
    ],
    [
      "a rate limit",
      {},
      { kind: "status" as const, status: 429, error: "RATE_LIMITED", retryAfterSeconds: 20 },
      /Wait 20 seconds/,
    ],
    [
      "an unavailable service",
      {},
      { kind: "status" as const, status: 503, error: "UNAVAILABLE" },
      /isn’t available right now/,
    ],
    ["no connection", {}, { kind: "network" as const }, /offline/],
  ])("explains %s and never echoes the invitation", async (_name, state, failure, text) => {
    const h = harness(state);
    if (failure) h.server.failNext("redeem", failure);
    mount(h);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const failureEl = await alertEl();
    expect(failureEl.textContent).toMatch(text);
    expect(failureEl.querySelector('[aria-hidden="true"]')?.textContent).toContain("⚠");
    const field = screen.getByLabelText("Invitation");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedBy).toHaveLength(2);
    expect(describedBy.every((id) => Boolean(document.getElementById(id)))).toBe(true);
    expect(document.body.textContent).not.toContain("inv-0123456789abcdef");
  });

  it("a lost answer then the same invitation again finishes the connection (the server spends it once)", async () => {
    const h = harness({ redeem: "uncertain" });
    mount(h);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Not finished")).toBeTruthy();
    h.server.state.redeem = "connected";
    await user.type(screen.getByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected. Feedback is on.")).toBeTruthy();
    expect(h.server.invitations).toEqual(["inv-0123456789abcdef", "inv-0123456789abcdef"]);
  });

  it("an enrollment that already exists is simply connected", async () => {
    const h = harness();
    mount(h);
    await screen.findByLabelText("Invitation");
    h.server.state.status = "connected";
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected. Feedback is on.")).toBeTruthy();
  });

  it("a session that ended while connecting hides the section instead of failing", async () => {
    const h = harness();
    mount(h);
    await screen.findByLabelText("Invitation");
    h.server.state.session = "out";
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Invitation"), "inv-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Send feedback to the developer" })).toBeNull(),
    );
  });
});

describe("Settings section: disconnect and unsent reports", () => {
  it("confirms before disconnecting; Keep connected backs out and is focused", async () => {
    const h = harness(connectedState);
    mount(h);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(
      screen.getByText(/Disconnect feedback\? It ends your access on every device/),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep connected" }));
    await user.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(h.server.count("disconnect")).toBe(0);
    expect(screen.queryByText(/Disconnect feedback\?/)).toBeNull();
  });

  it.each([
    ["ended", { revoked: true }, undefined],
    ["nothing", { revoked: false }, undefined],
    ["failed", {}, { kind: "status" as const, status: 502, error: "UNCERTAIN" }],
    ["offline", {}, { kind: "network" as const }],
  ] as const)("reports a disconnect that is %s truthfully", async (key, state, failure) => {
    const h = harness({ ...connectedState, ...state });
    if (failure) h.server.failNext("disconnect", failure);
    mount(h);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(screen.getAllByRole("button", { name: "Disconnect" })[0]!);
    expect(await screen.findByText(DISCONNECT_RESULT[key])).toBeTruthy();
    expect(h.server.count("disconnect")).toBe(1);
    // A failed disconnect changed nothing: still connected. An ended one is not.
    if (key === "failed" || key === "offline") expect(screen.getByText("Connected")).toBeTruthy();
    else await waitFor(() => expect(screen.queryByText("Connected")).toBeNull());
  });

  it("shows how many reports wait or could not be delivered, and offers to delete them with a confirm", async () => {
    const h = harness(connectedState);
    mount(h);
    await waitFor(() => expect(h.outbox.create).toHaveBeenCalled());
    await waitFor(() => expect(h.outbox.box.subscribe).toHaveBeenCalled());
    h.outbox.status({ items: 3, blocked: 1 });
    expect(await screen.findByText("3 reports waiting to send on this device.")).toBeTruthy();
    expect(screen.getByText("1 couldn’t be delivered. They are kept on this device.")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete unsent reports" }));
    expect(
      screen.getByText(/Delete 4 unsent reports from this device\? They won’t be sent/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep them" }));
    expect(h.outbox.box.clear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete unsent reports" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.outbox.box.clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Unsent reports deleted from this device.")).toBeTruthy();
  });

  it("says one waiting report in the singular", async () => {
    const h = harness(connectedState);
    mount(h);
    await waitFor(() => expect(h.outbox.box.subscribe).toHaveBeenCalled());
    h.outbox.status({ items: 1, blocked: 0 });
    expect(await screen.findByText("1 report waiting to send on this device.")).toBeTruthy();
  });
});

describe("the notice banner", () => {
  it.each([
    ["expired", /Your feedback access has expired/, "Reconnect"],
    ["revoked", /Your feedback access was ended/, "Add invitation"],
    ["needs_reconnect", /saved feedback connection can’t be reopened/, "Add invitation"],
    ["disabled", /Feedback is switched off for now/, "See details"],
    ["unavailable", /Feedback isn’t available right now/, "See details"],
  ] as const)("shows %s with its action", async (status, text, action) => {
    mount(harness({ status }), <FeedbackNotice />);
    const banner = await waitFor(() => {
      const el = document.querySelector(".feedback-notice");
      if (!el) throw new Error("no banner");
      return el;
    });
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toMatch(text);
    expect(screen.getByRole("link", { name: action }).getAttribute("href")).toBe(
      "/settings#settings-feedback",
    );
  });

  it("shows 'finish connecting' for a pending redemption", async () => {
    mount(harness({ redemption: "pending" }), <FeedbackNotice />);
    const link = await screen.findByRole("link", { name: "Finish connecting" });
    expect(link.getAttribute("href")).toBe("/settings#settings-feedback");
    expect(document.querySelector(".feedback-notice")?.textContent).toMatch(/won’t be spent twice/);
  });

  it("shows undeliverable reports when nothing else needs attention, and the enrollment notice wins", async () => {
    const h = harness(connectedState);
    mount(h, <FeedbackNotice />);
    await waitFor(() => expect(h.outbox.box.subscribe).toHaveBeenCalled());
    h.outbox.status({ blocked: 2 });
    expect(await screen.findByText(/Some feedback couldn’t be delivered/)).toBeTruthy();
    h.server.state.status = "expired";
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(await screen.findByText(/Your feedback access has expired/)).toBeTruthy();
  });

  it("shows nothing when all is well, and nothing on Settings", async () => {
    const h = harness(connectedState);
    mount(h, <FeedbackNotice />);
    await waitFor(() => expect(h.server.count("status")).toBe(1));
    expect(document.querySelector(".feedback-notice")).toBeNull();
    pathname = "/settings";
    h.server.state.status = "expired";
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(h.server.count("status")).toBe(2));
    expect(document.querySelector(".feedback-notice")).toBeNull();
  });
});

describe("the Feedback button", () => {
  it("is labelled, disabled unless connected, and absent on Settings", async () => {
    const h = harness();
    const view = mount(h, <FeedbackButton />);
    const button = await screen.findByRole("button", { name: "Send feedback" });
    expect(button).toHaveProperty("disabled", true);
    h.server.state.status = "connected";
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    pathname = "/settings";
    view.rerender(providerFor(h, <FeedbackButton />));
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });

  it.each(["expired", "revoked", "needs_reconnect", "disabled", "unavailable"] as const)(
    "is disabled when the enrollment is %s",
    async (status) => {
      mount(harness({ status }), <FeedbackButton />);
      const button = await screen.findByRole("button", { name: "Send feedback" });
      await waitFor(() => expect(button).toHaveProperty("disabled", true));
    },
  );
});

describe("accountDatabaseName is what the provider sweeps by", () => {
  it("keeps the current account's database when the page loads", async () => {
    const h = harness(connectedState);
    h.idb.add(accountDatabaseName(OUTBOX_KEY_A));
    mount(h);
    await waitFor(() => expect(h.outbox.create).toHaveBeenCalled());
    expect(h.idb.present.has(accountDatabaseName(OUTBOX_KEY_A))).toBe(true);
  });
});
