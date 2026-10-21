// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlaytestAccess,
  type AccessStatus,
  type EnrollmentStore,
  type PlaytestAccess,
} from "@masra91/framebriar/browser/playtest-access";
import { ToastProvider } from "@/components/ui/Toast";
import { createFakeFramebriar } from "@/test/fake-framebriar";
import { feedbackBuildSha } from "./build-sha";
import { FeedbackAccessProvider, resultAfterFailedConnect } from "./FeedbackAccess";
import { FeedbackButton } from "./FeedbackButton";
import { FeedbackNotice } from "./FeedbackNotice";
import { CONNECT_FAILURE, expiryText, FeedbackSettings } from "./FeedbackSettings";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

function memoryStore(): EnrollmentStore {
  let record: Awaited<ReturnType<EnrollmentStore["read"]>> = { revision: 0, session: null };
  return {
    read: async () => structuredClone(record),
    write: async (session, revision) => {
      if (record.revision !== revision) return false;
      record = { revision, session: { ...session } };
      return true;
    },
    reset: async ({ expectedRevision, notice } = {}) => {
      if (expectedRevision !== undefined && record.revision !== expectedRevision) return null;
      const revision = record.revision + 1;
      record = {
        revision,
        session: null,
        ...(notice
          ? {
              notice: {
                state: notice.state,
                expiresAt: notice.expiresAt ?? null,
                enrolled: notice.enrolled !== false,
              },
            }
          : {}),
      };
      return revision;
    },
    subscribe: () => () => undefined,
    close: () => undefined,
  };
}

const STATUS: AccessStatus = {
  state: "disconnected",
  connected: false,
  enrolled: false,
  canCapture: false,
  notice: null,
  expiresAt: null,
};

/** A controllable stand-in for the controller, to show every status and notice without driving the service into it. */
function stub(initial: Partial<AccessStatus> = {}, over: Partial<PlaytestAccess> = {}) {
  let status = { ...STATUS, ...initial };
  const listeners = new Set<(s: AccessStatus) => void>();
  const access = {
    endpoint: "x",
    status: () => status,
    subscribe: (listener: (s: AccessStatus) => void) => {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => status),
    stop: vi.fn(),
    connect: vi.fn(async () => true),
    getToken: async () => undefined,
    disconnect: vi.fn(async () => ({ forgotten: true, revoked: true as boolean | null })),
    dispose: vi.fn(),
    ...over,
  } as unknown as PlaytestAccess;
  return {
    access,
    push(next: Partial<AccessStatus>) {
      status = { ...status, ...next };
      act(() => listeners.forEach((l) => l(status)));
    },
  };
}

function mount(access: PlaytestAccess, ui: React.ReactNode = <FeedbackSettings />) {
  return render(
    <ToastProvider>
      <FeedbackAccessProvider create={async () => access}>{ui}</FeedbackAccessProvider>
    </ToastProvider>,
  );
}

const alertEl = () =>
  waitFor(() => {
    const el = document.querySelector(".field-error");
    if (!el) throw new Error("no failure shown");
    return el;
  });

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

describe("resultAfterFailedConnect", () => {
  it("maps what the controller reports onto the three failures", () => {
    expect(resultAfterFailedConnect({ ...STATUS, notice: "connection-uncertain" }, true)).toBe(
      "uncertain",
    );
    expect(resultAfterFailedConnect({ ...STATUS, notice: "access-required" }, true)).toBe(
      "invalid",
    );
    expect(resultAfterFailedConnect(STATUS, false)).toBe("offline");
  });
});

describe("expiryText", () => {
  it("formats the date and omits the line when there is none", () => {
    expect(expiryText("2026-11-19T12:00:00.000Z")).toBe("Feedback works until Nov 19, 2026.");
    expect(expiryText(null)).toBeNull();
    expect(expiryText("nonsense")).toBeNull();
  });
});

describe("the provider", () => {
  it("starts on load, stops on pagehide, starts again on pageshow and disposes on unmount", async () => {
    const { access } = stub();
    const view = mount(access);
    await waitFor(() => expect(access.start).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("pagehide"));
    expect(access.stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pageshow"));
    expect(access.start).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(access.dispose).toHaveBeenCalled();
  });

  it("disposes a controller that arrives after unmount, and survives one that fails to load", async () => {
    const { access } = stub();
    let release: (a: PlaytestAccess) => void = () => undefined;
    const late = new Promise<PlaytestAccess>((r) => (release = r));
    const view = render(
      <FeedbackAccessProvider create={() => late}>
        <p>x</p>
      </FeedbackAccessProvider>,
    );
    view.unmount();
    release(access);
    await waitFor(() => expect(access.dispose).toHaveBeenCalled());
    expect(access.start).not.toHaveBeenCalled();
    render(
      <FeedbackAccessProvider create={() => Promise.reject(new Error("no"))}>
        <p>fine</p>
      </FeedbackAccessProvider>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("before the controller is ready, Connect and Disconnect do nothing harmful", async () => {
    render(
      <ToastProvider>
        <FeedbackAccessProvider create={() => new Promise<PlaytestAccess>(() => undefined)}>
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Invitation"), "abc");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await alertEl()).toHaveProperty("textContent", CONNECT_FAILURE.uncertain);
  });
});

describe("Settings section: connecting", () => {
  it("shows the spec copy and an invitation field that is a password input", () => {
    mount(stub().access);
    expect(screen.getByRole("heading", { name: "Send feedback to the developer" })).toBeTruthy();
    const field = screen.getByLabelText("Invitation");
    expect(field).toHaveProperty("type", "password");
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

  it("clears the field the moment Connect is pressed, shows Connecting…, then toasts on success", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const { access, push } = stub(
      {},
      { connect: vi.fn(() => new Promise<boolean>((r) => (finish = r))) },
    );
    mount(access);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Invitation");
    await user.type(field, " secret-code ");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(access.connect).toHaveBeenCalledWith("secret-code");
    expect(field).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Connecting…" })).toHaveProperty("disabled", true);
    push({ connected: true, state: "connected", canCapture: true });
    await act(async () => finish(true));
    expect(await screen.findByText("Connected. Feedback is on.")).toBeTruthy();
  });

  it("explains each failure and never echoes the invitation", async () => {
    const connect = vi.fn(async () => false);
    const { access, push } = stub({}, { connect });
    mount(access);
    const user = userEvent.setup();
    const attempt = async () => {
      await user.type(screen.getByLabelText("Invitation"), "code-1");
      await user.click(screen.getByRole("button", { name: "Connect" }));
    };
    await attempt();
    expect((await alertEl()).textContent).toBe(CONNECT_FAILURE.invalid);
    push({ notice: "connection-uncertain" });
    await attempt();
    await waitFor(() =>
      expect(document.querySelector(".field-error")?.textContent).toBe(CONNECT_FAILURE.uncertain),
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    push({ notice: null });
    await attempt();
    await waitFor(() =>
      expect(document.querySelector(".field-error")?.textContent).toBe(CONNECT_FAILURE.offline),
    );
    expect(document.body.textContent).not.toContain("code-1");
  });
});

describe("Settings section: connected and disconnect", () => {
  const connectedStatus = {
    connected: true,
    state: "connected",
    canCapture: true,
    expiresAt: "2026-11-19T12:00:00.000Z",
  };

  it("shows Connected with the expiry and hides the form until Use a new invitation", async () => {
    mount(stub(connectedStatus).access);
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByText("Feedback works until Nov 19, 2026.")).toBeTruthy();
    expect(screen.queryByLabelText("Invitation")).toBeNull();
    const user = userEvent.setup();
    const replace = screen.getByRole("button", { name: "Use a new invitation" });
    expect(replace.getAttribute("aria-expanded")).toBe("false");
    await user.click(replace);
    expect(replace.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Invitation")).toBeTruthy();
    await user.click(replace);
    expect(screen.queryByLabelText("Invitation")).toBeNull();
  });

  it("omits the expiry when there is none", async () => {
    mount(stub({ ...connectedStatus, expiresAt: null }).access);
    await screen.findByText("Connected");
    expect(screen.queryByText(/Feedback works until/)).toBeNull();
  });

  it("confirms before disconnecting; Keep connected backs out and is focused", async () => {
    const { access } = stub(connectedStatus);
    mount(access);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/Disconnect feedback\? You’ll need a new invitation/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep connected" }));
    await user.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(access.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByText(/Disconnect feedback\?/)).toBeNull();
  });

  it.each([
    [true, "Disconnected. Feedback access was removed from this device and ended."],
    [
      false,
      "Disconnected on this device. We couldn’t reach the service to end the access, so it may stay valid until it expires. Ask the developer to revoke it if you want it ended sooner.",
    ],
    [
      null,
      "Disconnected on this device. We couldn’t reach the service to end the access, so it may stay valid until it expires. Ask the developer to revoke it if you want it ended sooner.",
    ],
  ])("reports a disconnect whose revoked flag is %s", async (revoked, message) => {
    const { access, push } = stub(connectedStatus, {
      disconnect: vi.fn(async () => ({ forgotten: true, revoked })),
    });
    mount(access);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(screen.getAllByRole("button", { name: "Disconnect" })[0]!);
    push({ connected: false, state: "disconnected", canCapture: false });
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe("Settings section: notices", () => {
  it.each([
    ["expired", "Expired"],
    ["access-required", "Needs invitation"],
    ["migration-required", "Needs invitation"],
    ["connection-uncertain", "Not confirmed"],
  ] as const)("badges %s as %s", async (notice, badge) => {
    mount(stub({ notice }).access);
    expect(await screen.findByText(badge)).toBeTruthy();
    expect(screen.getByLabelText("Invitation")).toBeTruthy();
  });
});

describe("the notice banner", () => {
  it.each([
    ["expired", /Your feedback access has expired/, "Reconnect"],
    ["access-required", /needs a new invitation before it can send/, "Add invitation"],
    ["connection-uncertain", /couldn’t confirm your feedback connection/, "Check connection"],
    ["migration-required", /more than one feedback connection/, "Add invitation"],
  ] as const)("shows %s with its action", async (notice, text, action) => {
    mount(stub({ notice }).access, <FeedbackNotice />);
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

  it("shows nothing when all is well, and nothing on Settings", async () => {
    const { access, push } = stub();
    mount(access, <FeedbackNotice />);
    await waitFor(() => expect(access.start).toHaveBeenCalled());
    expect(document.querySelector(".feedback-notice")).toBeNull();
    pathname = "/settings";
    push({ notice: "expired" });
    expect(document.querySelector(".feedback-notice")).toBeNull();
  });
});

describe("the Feedback button", () => {
  it("is labelled, disabled until capture is possible, and absent on Settings", async () => {
    const { access, push } = stub();
    const view = mount(access, <FeedbackButton />);
    const button = await screen.findByRole("button", { name: "Send feedback" });
    expect(button).toHaveProperty("disabled", true);
    push({ connected: true, canCapture: true });
    expect(button).toHaveProperty("disabled", false);
    pathname = "/settings";
    view.rerender(
      <ToastProvider>
        <FeedbackAccessProvider create={async () => access}>
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});

describe("against the real SDK and the fake service", () => {
  it("connects with an invitation, survives a reload, and disconnects with the access ended", async () => {
    const fake = createFakeFramebriar();
    const store = memoryStore();
    const create = async () =>
      createPlaytestAccess({
        gameId: "travel-packing",
        buildSha: null,
        origin: "http://localhost:3102",
        store,
        fetchImpl: fake.fetch as typeof fetch,
        events: null,
        retryDelay: async () => undefined,
      });
    const user = userEvent.setup();
    const first = render(
      <ToastProvider>
        <FeedbackAccessProvider create={create}>
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await user.type(await screen.findByLabelText("Invitation"), fake.issueInvitation());
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected. Feedback is on.")).toBeTruthy();
    first.unmount();

    render(
      <ToastProvider>
        <FeedbackAccessProvider create={create}>
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(screen.getAllByRole("button", { name: "Disconnect" })[0]!);
    expect(
      await screen.findByText(
        "Disconnected. Feedback access was removed from this device and ended.",
      ),
    ).toBeTruthy();
    expect(fake.count("disconnect")).toBe(1);
  });

  it("an unusable invitation gets the could-not-use copy", async () => {
    const fake = createFakeFramebriar();
    const create = async () =>
      createPlaytestAccess({
        gameId: "travel-packing",
        buildSha: null,
        origin: "http://localhost:3102",
        store: memoryStore(),
        fetchImpl: fake.fetch as typeof fetch,
        events: null,
        retryDelay: async () => undefined,
      });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <FeedbackAccessProvider create={create}>
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await user.type(await screen.findByLabelText("Invitation"), "A".repeat(43));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect((await alertEl()).textContent).toBe(CONNECT_FAILURE.invalid);
  });
});
