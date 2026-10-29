// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { accountDatabaseName } from "@/features/feedback/account-scope";
import { clearLocalFeedbackAfterAccountClosure } from "@/features/feedback/account-closure-cleanup";
import { disconnectText } from "@/features/feedback/disconnect-copy";
import { FeedbackAccessProvider } from "@/features/feedback/FeedbackAccess";
import {
  createFakeFeedbackServer,
  createMemoryIdb,
  OUTBOX_KEY_A,
  OUTBOX_KEY_B,
} from "@/test/fake-feedback-server";
import { createFakeOutbox } from "@/test/fake-outbox";
import { CloseAccountSheet } from "./CloseAccountSheet";
import type { CloseAccountState } from "./close-account-state";

const EXPIRES = "2026-11-19T12:00:00.000Z";
const connected = { status: "connected" as const, expiresAt: EXPIRES };
const idle: CloseAccountState = { error: null, fieldErrors: {} };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(
  initial: Parameters<typeof createFakeFeedbackServer>[0] = {},
  action: (
    previous: CloseAccountState,
    formData: FormData,
  ) => Promise<CloseAccountState> = async () => idle,
  fetchWrapper?: (fetchImpl: typeof fetch) => typeof fetch,
) {
  const server = createFakeFeedbackServer(initial);
  const outbox = createFakeOutbox();
  const idb = createMemoryIdb();
  const onClose = vi.fn();
  const submitted = vi.fn(action);
  const fetchImpl = fetchWrapper ? fetchWrapper(server.fetch) : server.fetch;
  render(
    <ToastProvider>
      <FeedbackAccessProvider
        enabled
        fetchImpl={fetchImpl}
        createOutbox={outbox.create}
        indexedDBImpl={idb.factory}
        preload={async () => undefined}
        createChannel={() => null}
      >
        <CloseAccountSheet action={submitted} onClose={onClose} />
      </FeedbackAccessProvider>
    </ToastProvider>,
  );
  return { server, outbox, idb, onClose, submitted, user: userEvent.setup() };
}

const stepOneHeading = () => screen.findByRole("heading", { name: "Disconnect feedback first" });
const stepTwoHeading = () => screen.findByRole("heading", { name: "Close your account?" });
const passwordField = () => screen.queryByLabelText("Current password");
const pressDisconnect = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^(Disconnect|Try again)$/ }));

describe("Close account: no feedback involved", () => {
  it("opens straight on the confirmation, exactly as before, with no step label", async () => {
    open({ status: "not-connected" });
    await stepTwoHeading();
    expect(screen.queryByText(/Step \d of 2/)).toBeNull();
    expect(screen.queryByText("Disconnect feedback first")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(passwordField()));
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeTruthy();
  });

  it("says feedback you already sent can't be deleted from here", async () => {
    open({ status: "not-connected" });
    await stepTwoHeading();
    expect(
      screen.getByText(/Feedback you already sent to the developer can’t be deleted/),
    ).toBeTruthy();
  });

  it("marks the DELETE phrase as a code so password managers do not treat it as an email field", async () => {
    open({ status: "not-connected" });
    await stepTwoHeading();
    const confirmation = screen.getByLabelText("Type DELETE to confirm");
    expect(confirmation.getAttribute("autocomplete")).toBe("one-time-code");
    expect(confirmation.getAttribute("autocomplete")).not.toBe("email");
  });

  it("unsent reports only (no record): no step 1, one extra line on the confirmation", async () => {
    const h = open({ status: "not-connected" });
    await stepTwoHeading();
    await waitFor(() => expect(h.outbox.box.subscribe).toHaveBeenCalled());
    h.outbox.status({ items: 2, blocked: 1 });
    expect(
      await screen.findByText(
        "3 unsent reports on this device will be deleted when you close your account. They won’t be sent.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Step \d of 2/)).toBeNull();
  });
});

describe("Close account: step 1, Disconnect feedback first", () => {
  it("shows while a record exists, with no password or DELETE field anywhere in the page", async () => {
    open(connected);
    await stepOneHeading();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Feedback works until Nov 19, 2026.")).toBeTruthy();
    expect(
      screen.getByText(/Disconnecting ends your feedback access on every device/),
    ).toBeTruthy();
    expect(screen.getByText("Feedback you already sent can’t be deleted from here.")).toBeTruthy();
    expect(passwordField()).toBeNull();
    expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close account permanently" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(document.querySelector("[data-feedback-sensitive-portal]")).not.toBeNull();
  });

  it.each([
    ["expired", { status: "expired" as const }, "Expired"],
    ["ended", { status: "revoked" as const }, "Ended"],
    ["needing an invitation", { status: "needs_reconnect" as const }, "Needs invitation"],
    ["switched off", { status: "disabled" as const }, "Switched off"],
    [
      "a connection that did not finish",
      { status: "not-connected" as const, redemption: "pending" as const },
      "Not finished",
    ],
  ])("shows for a record that is %s, with its badge", async (_label, state, badge) => {
    open(state);
    await stepOneHeading();
    expect(screen.getByText(badge)).toBeTruthy();
  });

  it("while the status is unknown it says so, with Cancel only, then resolves", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = open(
      connected,
      undefined,
      (real) =>
        (async (...args: Parameters<typeof fetch>) => {
          await held;
          return real(...args);
        }) as typeof fetch,
    );
    expect(screen.getByText("Checking your feedback access…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(passwordField()).toBeNull();
    release();
    await screen.findByRole("button", { name: "Disconnect" });
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes without disconnecting anything", async () => {
    const h = open(connected);
    await stepOneHeading();
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.server.count("disconnect")).toBe(0);
  });

  it("names the unsent reports and says other devices cannot be reached from here", async () => {
    const h = open(connected);
    await stepOneHeading();
    await waitFor(() => expect(h.outbox.box.subscribe).toHaveBeenCalled());
    h.outbox.status({ items: 1, blocked: 0 });
    expect(
      await screen.findByText(
        "1 unsent report on this device will be deleted when you close your account. They won’t be sent.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Reports saved on your other devices can’t be reached from here."),
    ).toBeTruthy();
    expect(h.outbox.box.clear).not.toHaveBeenCalled();
  });

  it("offers no unsent text when nothing is waiting", async () => {
    open(connected);
    await stepOneHeading();
    expect(screen.queryByText(/unsent report/)).toBeNull();
    expect(screen.queryByText(/other devices can’t be reached/)).toBeNull();
  });
});

describe("Close account: the Disconnect results, each staying inside the sheet", () => {
  it.each([
    ["ended", { disconnectOutcome: "ended" as const }],
    ["nothing", { disconnectOutcome: "nothing" as const }],
    ["erased_unrevocable", { disconnectOutcome: "erased_unrevocable" as const }],
  ] as const)(
    "%s: a status message and Continue (focused), never auto-advancing",
    async (outcome, state) => {
      const h = open({ ...connected, ...state });
      await stepOneHeading();
      await pressDisconnect(h.user);
      const message = await screen.findByText(disconnectText(outcome, EXPIRES));
      expect(message.closest("[role]")?.getAttribute("role")).toBe("status");
      const next = screen.getByRole("button", { name: "Continue" });
      await waitFor(() => expect(document.activeElement).toBe(next));
      expect(next.getAttribute("aria-describedby")).toBe(message.closest("[role]")?.id);
      expect(screen.queryByRole("button", { name: /Disconnect|Try again/ })).toBeNull();
      // The step is latched: the refreshed status says nothing is held any more, and it is still step 1 with its message.
      await waitFor(() => expect(h.server.count("status")).toBeGreaterThan(1));
      expect(screen.getByText("Step 1 of 2")).toBeTruthy();
      expect(screen.getByText(disconnectText(outcome, EXPIRES))).toBeTruthy();
      expect(passwordField()).toBeNull();
    },
  );

  it.each([
    ["partial", { kind: "status" as const, status: 503, error: "PARTIAL" }, "Try again"],
    ["unavailable", { kind: "status" as const, status: 503, error: "UNAVAILABLE" }, "Try again"],
    ["uncertain", { kind: "status" as const, status: 502, error: "UNCERTAIN" }, "Try again"],
    ["pending", { kind: "status" as const, status: 409, error: "PENDING_REDEMPTION" }, "Try again"],
    ["offline", { kind: "network" as const }, "Disconnect"],
  ] as const)(
    "%s: stays on step 1 as an alert, with nothing that moves toward deletion",
    async (key, failure, label) => {
      const h = open(connected);
      h.server.failNext("disconnect", failure);
      await stepOneHeading();
      await pressDisconnect(h.user);
      const message = await screen.findByText(disconnectText(key));
      expect(message.closest("[role]")?.getAttribute("role")).toBe("alert");
      expect(message.parentElement?.textContent?.startsWith("⚠")).toBe(true);
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
      expect(passwordField()).toBeNull();
      expect(screen.getByText("Step 1 of 2")).toBeTruthy();
      const retry = screen.getByRole("button", { name: label });
      await waitFor(() => expect(document.activeElement).toBe(retry));
      expect((retry as HTMLButtonElement).disabled).toBe(false);
    },
  );

  it("a retry clears the old message first and can then succeed", async () => {
    const h = open({ ...connected, disconnectOutcome: "ended" });
    h.server.failNext("disconnect", { kind: "status", status: 502, error: "UNCERTAIN" });
    await stepOneHeading();
    await pressDisconnect(h.user);
    await screen.findByText(disconnectText("uncertain"));
    await pressDisconnect(h.user);
    expect(await screen.findByText(disconnectText("ended"))).toBeTruthy();
    expect(screen.queryByText(disconnectText("uncertain"))).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("a signed-out session gets its own honest message, not 'you're still connected'", async () => {
    const h = open(connected);
    await stepOneHeading();
    h.server.state.session = "out";
    await pressDisconnect(h.user);
    const message = await screen.findByText(disconnectText("signed-out"));
    expect(message.closest("[role]")?.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(/still connected/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(passwordField()).toBeNull();
  });

  it("while a disconnect is in flight Cancel is disabled, Escape is ignored and the button is busy", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = open(
      connected,
      undefined,
      (real) =>
        (async (...args: Parameters<typeof fetch>) => {
          if (String(args[0]).endsWith("/disconnect")) await held;
          return real(...args);
        }) as typeof fetch,
    );
    await stepOneHeading();
    await pressDisconnect(h.user);
    const busy = await screen.findByRole("button", { name: "Disconnecting…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await h.user.keyboard("{Escape}");
    expect(h.onClose).not.toHaveBeenCalled();
    release();
    await screen.findByRole("button", { name: "Continue" });
    await h.user.keyboard("{Escape}");
    expect(h.onClose).toHaveBeenCalledOnce();
  });
});

describe("Close account: step 2 after step 1", () => {
  it("Continue goes to the confirmation: labelled step 2, password focused, fields blank, no Back", async () => {
    const h = open({ ...connected, disconnectOutcome: "ended" });
    await stepOneHeading();
    await pressDisconnect(h.user);
    const continueButton = await screen.findByRole("button", { name: "Continue" });
    await h.user.click(continueButton);
    await stepTwoHeading();
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    // Pressing Continue must not also submit the blank closing form: the button that follows it is a submit button, so it must be a
    // new element, never the very one that was just clicked (a click that turns its target into a submit button submits the form).
    expect(h.submitted).not.toHaveBeenCalled();
    expect(continueButton.isConnected).toBe(false);
    expect(screen.getByRole("button", { name: "Close account permanently" })).not.toBe(
      continueButton,
    );
    await waitFor(() => expect(document.activeElement).toBe(passwordField()));
    expect((passwordField() as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Type DELETE to confirm") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    expect(
      screen.queryByText("Any feedback access that couldn’t be ended", { exact: false }),
    ).toBeNull();
  });

  it("after an unrevocable disconnect the confirmation says the leftover access stops on its own, with the date", async () => {
    const h = open({ ...connected, disconnectOutcome: "erased_unrevocable" });
    await stepOneHeading();
    await pressDisconnect(h.user);
    await h.user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText(
        "Any feedback access that couldn’t be ended stops on its own on Nov 19, 2026.",
      ),
    ).toBeTruthy();
  });

  it("without a known date the line names no date", async () => {
    const h = open({ status: "needs_reconnect", disconnectOutcome: "erased_unrevocable" });
    await stepOneHeading();
    await pressDisconnect(h.user);
    await h.user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Any feedback access that couldn’t be ended stops on its own."),
    ).toBeTruthy();
  });

  it("Cancel after disconnecting closes the sheet and leaves the person disconnected", async () => {
    const h = open({ ...connected, disconnectOutcome: "ended" });
    await stepOneHeading();
    await pressDisconnect(h.user);
    await h.user.click(await screen.findByRole("button", { name: "Continue" }));
    await stepTwoHeading();
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.server.state.status).toBe("not-connected");
  });
});

describe("Close account: the server refuses (a stale tab or a second device)", () => {
  it("sends the sheet back to step 1 with the alert, removes the password and DELETE fields, and asks the server again", async () => {
    const h = open({ status: "not-connected" }, async () => ({
      error: null,
      fieldErrors: {},
      feedbackBlocking: true,
    }));
    await stepTwoHeading();
    // Another device connects while this sheet is open.
    h.server.state.status = "connected";
    h.server.state.expiresAt = EXPIRES;
    const before = h.server.count("status");
    await h.user.type(passwordField() as HTMLElement, "synthetic-secret-value");
    await h.user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await h.user.click(screen.getByRole("button", { name: "Close account permanently" }));
    await stepOneHeading();
    expect(
      screen.getByText(
        "Feedback is still connected to your account, possibly from another device or tab. Disconnect it to continue. Nothing was deleted.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(passwordField()).toBeNull();
    expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
    expect(document.body.textContent).not.toContain("synthetic-secret-value");
    await waitFor(() => expect(h.server.count("status")).toBeGreaterThan(before));
    await screen.findByText("Connected");
    // Disconnect works here, Continue returns to a blank confirmation.
    await pressDisconnect(h.user);
    await h.user.click(await screen.findByRole("button", { name: "Continue" }));
    await stepTwoHeading();
    expect((passwordField() as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
  });

  it("if the disconnect then finds nothing held (the other device already did it), Continue still works", async () => {
    const h = open({ status: "not-connected" }, async () => ({
      error: null,
      fieldErrors: {},
      feedbackBlocking: true,
    }));
    await stepTwoHeading();
    await h.user.type(passwordField() as HTMLElement, "x");
    await h.user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await h.user.click(screen.getByRole("button", { name: "Close account permanently" }));
    await stepOneHeading();
    h.server.state.hasRecord = true;
    await pressDisconnect(h.user);
    expect(await screen.findByText(disconnectText("nothing"))).toBeTruthy();
    expect(screen.queryByText(/still connected to your account/)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
});

describe("Close account: only this account's unsent outbox is cleared, and only at closure", () => {
  const cleanup = (idb: ReturnType<typeof createMemoryIdb>) =>
    clearLocalFeedbackAfterAccountClosure({ enabled: () => true, indexedDB: () => idb.factory });

  it("pressing Close remembers this account's outbox, so another account's work in the same browser stays", async () => {
    // The action stays in flight (closure is under way) until the test ends; React runs async actions one after another, so it is
    // then settled rather than left hanging for the next test.
    let settle: (state: CloseAccountState) => void = () => undefined;
    const h = open(
      { status: "not-connected" },
      () => new Promise<CloseAccountState>((resolve) => (settle = resolve)),
    );
    await stepTwoHeading();
    // The provider sweeps stale account databases before it opens this account's outbox. Wait for that
    // initialization to finish so the fixture below measures closure cleanup, not the startup sweep.
    await waitFor(() => expect(h.outbox.box.start).toHaveBeenCalled());
    h.idb.add(accountDatabaseName(OUTBOX_KEY_A));
    h.idb.add(accountDatabaseName(OUTBOX_KEY_B));
    await h.user.type(passwordField() as HTMLElement, "x");
    await h.user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await h.user.click(screen.getByRole("button", { name: "Close account permanently" }));
    await screen.findByRole("button", { name: "Closing…" });
    await cleanup(h.idb);
    expect([...h.idb.present]).toEqual([accountDatabaseName(OUTBOX_KEY_B)]);
    await act(async () => settle(idle));
  });

  it("an attempt that failed is forgotten, and Cancel forgets too (nothing narrower is promised)", async () => {
    const h = open({ status: "not-connected" }, async () => ({
      error: "We couldn’t close your account. Nothing was deleted. Try again.",
      fieldErrors: {},
    }));
    await stepTwoHeading();
    await h.user.type(passwordField() as HTMLElement, "x");
    await h.user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await h.user.click(screen.getByRole("button", { name: "Close account permanently" }));
    await screen.findByText(/Nothing was deleted/);
    h.idb.add(accountDatabaseName(OUTBOX_KEY_A));
    h.idb.add(accountDatabaseName(OUTBOX_KEY_B));
    await cleanup(h.idb);
    expect([...h.idb.present]).toEqual([]);
  });

  it("a refused attempt (feedback still held) forgets it too", async () => {
    const h = open({ status: "not-connected" }, async () => ({
      error: null,
      fieldErrors: {},
      feedbackBlocking: true,
    }));
    await stepTwoHeading();
    h.server.state.status = "connected";
    await h.user.type(passwordField() as HTMLElement, "x");
    await h.user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await h.user.click(screen.getByRole("button", { name: "Close account permanently" }));
    await stepOneHeading();
    h.idb.add(accountDatabaseName(OUTBOX_KEY_A));
    h.idb.add(accountDatabaseName(OUTBOX_KEY_B));
    await cleanup(h.idb);
    expect([...h.idb.present]).toEqual([]);
  });
});
