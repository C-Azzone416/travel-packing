// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Nav } from "@/components/shell/Nav";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { createFakeFeedbackServer, createMemoryIdb } from "@/test/fake-feedback-server";
import { createFakeOutbox, OUTBOX_STATUS } from "@/test/fake-outbox";
import {
  FeedbackAccessProvider,
  FLUSH_LIMIT_MS,
  useFeedbackAccess,
  type FlushResult,
} from "./FeedbackAccess";
import { REPEAT_FEEDBACK_MS } from "./SignOutGuardSheet";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips" }));

type Entry = "nav" | "settings";

function ui(signOut: () => Promise<void>, entry: Entry) {
  return entry === "nav" ? (
    <Nav signOut={signOut} email="someone@example.test" />
  ) : (
    <SaveStatusProvider>
      <SettingsScreen
        email="someone@example.test"
        signOut={signOut}
        initialWeather={{ weatherOptIn: false, temperatureUnit: "F" }}
        updateWeather={async () => ({
          ok: true as const,
          settings: { weatherOptIn: false, temperatureUnit: "F" as const },
        })}
        initialAppearance="base"
        updateAppearance={async (appearance) => ({ ok: true as const, appearance })}
        accountClosureEnabled={false}
        closeAccount={async () => ({ error: null, fieldErrors: {} })}
      />
    </SaveStatusProvider>
  );
}

async function setup(
  options: {
    entry?: Entry;
    unsent?: number;
    blocked?: number;
    status?: "connected" | "not-connected";
    state?: "available" | "storage-unavailable";
  } = {},
) {
  const order: string[] = [];
  /** While set, a report send never answers (so it stays under way). */
  const held = { reports: false };
  const signOut = vi.fn(async () => {
    order.push("signOut");
  });
  const server = createFakeFeedbackServer({ status: options.status ?? "connected" });
  const outbox = createFakeOutbox();
  outbox.box.clear.mockImplementation(async () => {
    order.push("clear");
    return OUTBOX_STATUS;
  });
  render(
    <ToastProvider>
      <FeedbackAccessProvider
        enabled
        fetchImpl={(input, init) =>
          held.reports && String(input).includes("reports")
            ? new Promise<Response>(() => undefined)
            : server.fetch(input, init)
        }
        createOutbox={outbox.create}
        indexedDBImpl={createMemoryIdb().factory}
        preload={async () => undefined}
        createChannel={() => null}
      >
        {ui(signOut, options.entry ?? "nav")}
      </FeedbackAccessProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(outbox.box.start).toHaveBeenCalled());
  await waitFor(() => expect(server.count("status")).toBeGreaterThan(0));
  await outbox.status({
    state: options.state ?? "available",
    items: options.unsent ?? 0,
    blocked: options.blocked ?? 0,
  });
  /** What the SDK says is left after a send. */
  const left = (items: number, blocked = 0) => {
    outbox.box.status = () => ({ ...OUTBOX_STATUS, items, blocked });
  };
  /** The SDK reaches the transport when it really tries a report; with this a Send now ATTEMPTS (and fails). */
  const attempt = () => {
    outbox.box.start.mockImplementation(async () => {
      try {
        await outbox.created[0].send({ report: {}, media: null } as never);
      } catch {
        /* the attempt failing is the point */
      }
    });
  };
  return { signOut, order, outbox, server, left, attempt, held, user: userEvent.setup() };
}

const signOutButton = () => screen.getByRole("button", { name: "Sign out" });
const names = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((b) => b.textContent);
const CALM =
  "Not sent yet. They’ll retry on their own in a moment, so you can wait here or try again shortly.";
const ONE = "1 report hasn’t sent yet. Signing out deletes it from this device.";
const many = (n: number) =>
  `${n} reports haven’t sent yet. Signing out deletes them from this device.`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each<Entry>(["nav", "settings"])("sign-out warning from %s", (entry) => {
  it("with nothing unsent signs out in one tap, no sheet (clear, then signOut)", async () => {
    const t = await setup({ entry });
    await t.user.click(signOutButton());
    await waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(t.order).toEqual(["clear", "signOut"]);
  });

  it("with storage unavailable signs out in one tap", async () => {
    const t = await setup({ entry, unsent: 3, state: "storage-unavailable" });
    await t.user.click(signOutButton());
    await waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("warns, with the exact one-report copy, and the safe choice focused", async () => {
    const t = await setup({ entry, unsent: 1 });
    await t.user.click(signOutButton());
    const dialog = await screen.findByRole("dialog", { name: "Feedback hasn’t sent yet" });
    expect(t.signOut).not.toHaveBeenCalled();
    expect(within(dialog).getByText(ONE)).toBeTruthy();
    expect(
      within(dialog).getByText("Reports saved on your other devices aren’t affected."),
    ).toBeTruthy();
    expect(names()).toEqual(["Sign out anyway", "Stay signed in", "Send now"]);
    expect(screen.getByRole("button", { name: "Stay signed in" }).className).toBe(
      "button secondary",
    );
    expect(screen.getByRole("button", { name: "Sign out anyway" }).className).toContain("danger");
    expect(screen.getByRole("button", { name: "Send now" }).className).toBe("button");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByRole("button", { name: "Close dialog" })).toBeNull();
  });

  it("counts each report once: 2 waiting, 1 of them blocked, is 2 (not 3)", async () => {
    const t = await setup({ entry, unsent: 2, blocked: 1 });
    await t.user.click(signOutButton());
    expect(await screen.findByText(many(2))).toBeTruthy();
    expect(screen.queryByText(many(3))).toBeNull();
  });

  it("many reports", async () => {
    const t = await setup({ entry, unsent: 12 });
    await t.user.click(signOutButton());
    expect(await screen.findByText(many(12))).toBeTruthy();
  });

  it("opens for blocked-only reports (a blocked row is also a waiting row)", async () => {
    const t = await setup({ entry, unsent: 1, blocked: 1 });
    await t.user.click(signOutButton());
    expect(await screen.findByText(ONE)).toBeTruthy();
  });

  it("Stay signed in and Escape close without clearing, and focus returns to Sign out", async () => {
    const t = await setup({ entry, unsent: 2 });
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(signOutButton());
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    await t.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(signOutButton());
    expect(t.order).toEqual([]);
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("ignores a backdrop press", async () => {
    const t = await setup({ entry, unsent: 2 });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("traps focus: Tab and Shift+Tab wrap inside the sheet", async () => {
    const t = await setup({ entry, unsent: 2 });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    expect(document.activeElement?.textContent).toBe("Stay signed in");
    await t.user.tab();
    expect(document.activeElement?.textContent).toBe("Send now");
    await t.user.tab();
    expect(document.activeElement?.textContent).toBe("Sign out anyway");
    await t.user.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe("Send now");
  });

  it("Sign out anyway clears, then signs out, once, and the buttons go inert", async () => {
    const t = await setup({ entry, unsent: 2 });
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Sign out anyway" }));
    await t.user.click(screen.getByRole("button", { name: "Signing out…" }));
    await waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
    expect(t.order).toEqual(["clear", "signOut"]);
  });

  it("Send now that sends everything clears, then signs out once, saying so", async () => {
    const t = await setup({ entry, unsent: 2 });
    let finish: () => void = () => undefined;
    t.outbox.box.start.mockImplementation(
      () => new Promise<undefined>((done) => (finish = () => done(undefined))),
    );
    t.left(0);
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    const busy = screen.getByRole("button", { name: "Sending…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
      "Sending your reports…",
    );
    // A double tap, Stay and Escape do nothing while sending.
    const starts = t.outbox.box.start.mock.calls.length;
    await t.user.click(busy);
    await t.user.click(screen.getByRole("button", { name: "Stay signed in" }));
    await t.user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(t.outbox.box.start.mock.calls.length).toBe(starts);
    await act(async () => finish());
    await waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
    expect(t.order).toEqual(["clear", "signOut"]);
  });

  it("a partial send stays signed in: remaining count, alert, Try again with focus", async () => {
    const t = await setup({ entry, unsent: 3 });
    t.left(2);
    t.attempt();
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    await t.outbox.status({ items: 2 });
    const again = await screen.findByRole("button", { name: "Try again" });
    expect(await screen.findByText(many(2))).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain(
      "Some reports couldn’t be sent yet. They’re still on this device.",
    );
    expect(document.activeElement).toBe(again);
    expect(t.signOut).not.toHaveBeenCalled();
    expect(t.order).toEqual([]);
    // Stay clears the alert for next time.
    await t.user.click(screen.getByRole("button", { name: "Stay signed in" }));
    await t.user.click(signOutButton());
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("");
  });

  it("a flush that attempts nothing (still inside the retry delay) shows the calm line, not the alert", async () => {
    const t = await setup({ entry, unsent: 2, blocked: 1 });
    t.left(2, 1); // the SDK skipped them: start() resolves at once, nothing reached the transport, the count is unchanged
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    const again = await screen.findByRole("button", { name: "Try again" });
    const region = within(screen.getByRole("dialog")).getByRole("alert");
    expect(region.textContent).toBe(CALM);
    expect(region.querySelector(".auth-error")).toBeNull();
    expect(region.textContent).not.toContain("⚠");
    expect(screen.getByText(many(2))).toBeTruthy();
    expect(t.signOut).not.toHaveBeenCalled();
    expect(again).toBeTruthy();
  });

  it("an earlier, finished send does not make a later flush count as attempted", async () => {
    const t = await setup({ entry, unsent: 2 });
    t.left(2);
    // A background retry already happened and has finished (so the counters are not at their start values) ...
    await t.outbox.created[0].send({ report: {}, media: null } as never).catch(() => undefined);
    await t.user.click(signOutButton());
    // ... and now every report is inside its retry delay, so this tap tries nothing.
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    await screen.findByRole("button", { name: "Try again" });
    const region = within(screen.getByRole("dialog")).getByRole("alert");
    expect(region.textContent).toBe(CALM);
    expect(region.querySelector(".auth-error")).toBeNull();
  });

  it("joining a send that is already under way counts as an attempt (red alert, not the calm line)", async () => {
    const t = await setup({ entry, unsent: 2 });
    t.left(2);
    t.held.reports = true;
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    await screen.findByRole("button", { name: "Try again" });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(CALM);
    // A background retry is now in flight: the next tap joins it.
    void t.outbox.created[0].send({ report: {}, media: null } as never).catch(() => undefined);
    await t.user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain(
        "Still couldn’t send",
      ),
    );
  });

  it("an attempted failure shows the red alert; a second consecutive one says Still couldn’t send", async () => {
    const t = await setup({ entry, unsent: 2 });
    t.left(2);
    t.attempt();
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    const region = () => within(screen.getByRole("dialog")).getByRole("alert");
    await screen.findByRole("button", { name: "Try again" });
    expect(region().querySelector(".auth-error")?.textContent).toBe(
      "⚠ Some reports couldn’t be sent yet. They’re still on this device.",
    );
    const first = region().firstElementChild;
    await t.user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(region().querySelector(".auth-error")?.textContent).toBe(
        "⚠ Still couldn’t send. They’re still on this device.",
      ),
    );
    // A new element, so a screen reader reads it again.
    expect(region().firstElementChild).not.toBe(first);
  });

  it("a repeat tap keeps Sending… up for at least 600 ms", async () => {
    const t = await setup({ entry, unsent: 2 });
    t.left(2);
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    const again = await screen.findByRole("button", { name: "Try again" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(again);
    await act(async () => vi.advanceTimersByTimeAsync(REPEAT_FEEDBACK_MS - 100));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("the Sending… status is read out but takes no room", async () => {
    const t = await setup({ entry, unsent: 2 });
    t.left(0);
    t.outbox.box.start.mockImplementation(() => new Promise(() => undefined));
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    const status = within(screen.getByRole("dialog")).getByRole("status");
    expect(status.className).toBe("sr-only");
    expect(status.textContent).toBe("Sending your reports…");
  });

  it("a rejected send is a partial failure", async () => {
    const t = await setup({ entry, unsent: 1 });
    t.left(1);
    t.outbox.box.start.mockRejectedValue(new Error("nope"));
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Send now" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("the 15 s cap is a partial failure", async () => {
    const t = await setup({ entry, unsent: 1 });
    t.left(1);
    t.outbox.box.start.mockImplementation(() => new Promise(() => undefined));
    await t.user.click(signOutButton());
    const send = await screen.findByRole("button", { name: "Send now" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(send);
    await act(async () => vi.advanceTimersByTimeAsync(FLUSH_LIMIT_MS - 200));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("when a receipt brings the count to 0 it says so and signs nothing out by itself", async () => {
    const t = await setup({ entry, unsent: 1 });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    await t.outbox.status({ items: 0 });
    expect(screen.getByText("Everything has sent. You can sign out.")).toBeTruthy();
    expect(names()).toEqual(["Sign out", "Stay signed in"]);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }).className,
    ).toBe("button");
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("offline: no Send now, the reason shows, Stay is primary and focused", async () => {
    const t = await setup({ entry, unsent: 2 });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("You’re offline, so these can’t be sent right now.")).toBeTruthy();
    expect(names()).toEqual(["Sign out anyway", "Stay signed in"]);
    expect(screen.getByRole("button", { name: "Stay signed in" }).className).toBe("button");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay signed in" }));
  });
});

describe("sign-out warning, other states", () => {
  it("not connected: no Send now and its own reason", async () => {
    const t = await setup({ unsent: 2, status: "not-connected" });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    expect(screen.getByText("Feedback isn’t connected, so these can’t be sent.")).toBeTruthy();
    expect(names()).toEqual(["Sign out anyway", "Stay signed in"]);
  });

  it("offline wins over not connected", async () => {
    const t = await setup({ unsent: 2, status: "not-connected" });
    await t.user.click(signOutButton());
    await screen.findByRole("dialog");
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("You’re offline, so these can’t be sent right now.")).toBeTruthy();
    expect(screen.queryByText("Feedback isn’t connected, so these can’t be sent.")).toBeNull();
  });

  it("a signOut that throws returns the sheet to its choices", async () => {
    const t = await setup({ unsent: 2 });
    t.signOut.mockRejectedValueOnce(new Error("down"));
    await t.user.click(signOutButton());
    await t.user.click(await screen.findByRole("button", { name: "Sign out anyway" }));
    expect(await screen.findByRole("button", { name: "Sign out anyway" })).toBeTruthy();
  });
});

describe("clearLocal never blocks sign-out (#325 S1)", () => {
  it("signs out when box.stop() throws, and still clears", async () => {
    const t = await setup();
    t.outbox.box.stop.mockImplementationOnce(() => {
      throw new Error("stop failed");
    });
    await t.user.click(signOutButton());
    await waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
    expect(t.order).toEqual(["clear", "signOut"]);
  });

  it("signs out when the account channel throws", async () => {
    const signOut = vi.fn(async () => undefined);
    const outbox = createFakeOutbox();
    render(
      <FeedbackAccessProvider
        enabled
        fetchImpl={createFakeFeedbackServer({ status: "connected" }).fetch}
        createOutbox={outbox.create}
        indexedDBImpl={createMemoryIdb().factory}
        preload={async () => undefined}
        createChannel={() => ({
          onmessage: null,
          close: () => undefined,
          postMessage: () => {
            throw new Error("closed");
          },
        })}
      >
        <Nav signOut={signOut} email="someone@example.test" />
      </FeedbackAccessProvider>,
    );
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalled());
    await userEvent.setup().click(signOutButton());
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("flushNow without an outbox", () => {
  function Probe({ onValue }: { onValue: (n: Promise<FlushResult>) => void }) {
    const fb = useFeedbackAccess();
    return <button onClick={() => onValue(fb.flushNow())}>flush</button>;
  }

  it("resolves 0 where feedback is not built in", async () => {
    let result: Promise<FlushResult> = Promise.resolve({ remaining: -1, attempted: true });
    render(<Probe onValue={(n) => (result = n)} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "flush" }));
    await expect(result).resolves.toEqual({ remaining: 0, attempted: false });
  });

  it("resolves with the last count when this browser can keep no outbox", async () => {
    let result: Promise<FlushResult> = Promise.resolve({ remaining: -1, attempted: true });
    render(
      <FeedbackAccessProvider
        enabled
        fetchImpl={createFakeFeedbackServer({ status: "connected" }).fetch}
        createOutbox={async () => null}
        indexedDBImpl={createMemoryIdb().factory}
        preload={async () => undefined}
        createChannel={() => null}
      >
        <Probe onValue={(n) => (result = n)} />
      </FeedbackAccessProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "flush" }));
    await expect(result).resolves.toEqual({ remaining: 0, attempted: false });
  });
});
