// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableFeedback, OutboxStatus } from "@masra91/framebriar/browser/durable-feedback";
import type { AccessStatus, PlaytestAccess } from "@masra91/framebriar/browser/playtest-access";
import { ToastProvider } from "@/components/ui/Toast";
import {
  FeedbackAccessProvider,
  outboxView,
  saveFailure,
  type CreateOutbox,
} from "./FeedbackAccess";
import { FeedbackButton } from "./FeedbackButton";
import { COPY } from "./FeedbackSheet";

let pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const capture = vi.hoisted(() => ({ available: true, take: vi.fn() }));
vi.mock("@/features/feedback/screenshot-capture", () => ({
  get screenshotCaptureAvailable() {
    return capture.available;
  },
  captureScreenshot: () => capture.take(),
}));

const CONNECTED: AccessStatus = {
  state: "connected",
  connected: true,
  enrolled: true,
  canCapture: true,
  notice: null,
  expiresAt: null,
};

function accessStub(initial: Partial<AccessStatus> = {}) {
  let status = { ...CONNECTED, ...initial };
  const listeners = new Set<(s: AccessStatus) => void>();
  const access = {
    endpoint: "https://example.test/api",
    status: () => status,
    subscribe: (listener: (s: AccessStatus) => void) => {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => status),
    stop: vi.fn(),
    connect: vi.fn(async () => true),
    getToken: vi.fn(async () => "token"),
    disconnect: vi.fn(async () => ({ forgotten: true, revoked: true as boolean | null })),
    dispose: vi.fn(),
  } as unknown as PlaytestAccess;
  return {
    access,
    push(next: Partial<AccessStatus>) {
      status = { ...status, ...next };
      act(() => listeners.forEach((l) => l(status)));
    },
  };
}

const STATUS: OutboxStatus = {
  state: "available",
  items: 0,
  bytes: 0,
  maxItems: 10,
  maxBytes: 32 * 1024 * 1024,
  retention: "until-delivered-or-cleared",
};

type Enqueue = DurableFeedback["enqueue"];

function outboxStub(enqueue?: Enqueue) {
  let listener: ((s: OutboxStatus) => void) | undefined;
  let onReceipt: ((receipt: { id: string }) => void) | undefined;
  const box = {
    status: () => STATUS,
    subscribe: vi.fn((fn: (s: OutboxStatus) => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    }),
    enqueue: vi.fn<Enqueue>(
      enqueue ??
        (async ({ report }) => ({
          id: report.id,
          gameId: "travel-packing",
          status: "saved-local" as const,
          sent: false as const,
        })),
    ),
    start: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(),
    clear: vi.fn(),
  };
  const create: CreateOutbox = vi.fn(async (_access, receipt) => {
    onReceipt = receipt;
    return box as unknown as DurableFeedback;
  });
  return {
    box,
    create,
    status: (next: Partial<OutboxStatus>) => act(() => listener?.({ ...STATUS, ...next })),
    receive: (id: string) => act(() => onReceipt?.({ id })),
  };
}

function mount(
  options: { status?: Partial<AccessStatus>; outbox?: ReturnType<typeof outboxStub> } = {},
) {
  const access = accessStub(options.status);
  const outbox = options.outbox ?? outboxStub();
  const view = render(
    <ToastProvider>
      <FeedbackAccessProvider create={async () => access.access} createOutbox={outbox.create}>
        <FeedbackButton />
      </FeedbackAccessProvider>
    </ToastProvider>,
  );
  return { ...view, access, outbox };
}

const feedbackButton = () => screen.getByRole("button", { name: "Send feedback" });
const png = () => new Blob([new Uint8Array(64)], { type: "image/png" });

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(feedbackButton()).toHaveProperty("disabled", false));
  await user.click(feedbackButton());
  return screen.findByRole("dialog", { name: "Send feedback" });
}

beforeEach(() => {
  pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11";
  capture.available = true;
  capture.take.mockReset();
  capture.take.mockResolvedValue(png());
  URL.createObjectURL = vi.fn(() => "blob:thumbnail");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("the entry point", () => {
  it("is disabled until the person can capture", async () => {
    const { access } = mount({ status: { canCapture: false } });
    await waitFor(() => expect(feedbackButton()).toHaveProperty("disabled", true));
    access.push({ canCapture: true });
    expect(feedbackButton()).toHaveProperty("disabled", false);
  });

  it.each([
    "/settings",
    "/settings/x",
    "/sign-in",
    "/sign-up",
    "/verify",
    "/forgot-password",
    "/reset-password",
    "/finish-setup",
    "/access-denied",
  ])("is not offered on %s", async (path) => {
    pathname = path;
    mount();
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});

describe("the review sheet", () => {
  it("opens with its title and description and needs a note before Send", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openSheet(user);
    expect(within(dialog).getByText(COPY.description)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(COPY.notesLabel));
    expect(within(dialog).getByText(COPY.notesHelp)).toBeTruthy();
    expect(within(dialog).getByText(COPY.alsoSent)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByText(COPY.needNote)).toBeTruthy();
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "   ");
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "Count is off");
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    expect(within(dialog).queryByText(COPY.needNote)).toBeNull();
  });

  it("counts characters only past 1,800", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openSheet(user);
    const notes = within(dialog).getByLabelText(COPY.notesLabel);
    await user.click(notes);
    await user.paste("a".repeat(1800));
    expect(within(dialog).queryByText(/\/ 2,000/)).toBeNull();
    await user.paste("b".repeat(5));
    expect(within(dialog).getByText(/1,805 \/ 2,000/)).toBeTruthy();
    await user.paste("c".repeat(500));
    expect((notes as HTMLTextAreaElement).value).toHaveLength(2000);
  });

  it("Cancel closes it without saving anything", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "hello");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(outbox.box.enqueue).not.toHaveBeenCalled();
  });

  it("says when the person is offline, and Send still works", async () => {
    const user = userEvent.setup();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount();
    const dialog = await openSheet(user);
    expect(within(dialog).getByText(COPY.offline)).toBeTruthy();
    onLine.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(within(dialog).queryByText(COPY.offline)).toBeNull();
    onLine.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(within(dialog).getByText(COPY.offline)).toBeTruthy();
  });
});

describe("the screenshot option", () => {
  it("is ticked by default with a thumbnail and the plain warning", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openSheet(user);
    const box = within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel });
    expect(box).toHaveProperty("checked", true);
    expect(within(dialog).getByRole("img", { name: COPY.thumbnailAlt })).toBeTruthy();
    expect(within(dialog).getByText(COPY.screenshotNote)).toBeTruthy();
  });

  it("is taken before the sheet opens", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    expect(capture.take).toHaveBeenCalledTimes(1);
  });

  it("unticking removes the thumbnail and sends the notes only", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await user.click(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel }));
    expect(within(dialog).queryByRole("img")).toBeNull();
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "no picture");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    const { report, media } = outbox.box.enqueue.mock.calls[0][0];
    expect(report.media).toBeNull();
    expect(media).toBeNull();
  });

  it("a ticked screenshot goes with the report as a PNG with its hash", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "with picture");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    const { report, media } = outbox.box.enqueue.mock.calls[0][0];
    expect(report.media).toMatchObject({ type: "image/png", bytes: 64 });
    expect(report.media?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(media).toBeInstanceOf(Blob);
  });

  it("when the capture fails the box is unticked and disabled, and the notes still send", async () => {
    capture.take.mockResolvedValue(null);
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    const box = within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel });
    expect(box).toHaveProperty("checked", false);
    expect(box).toHaveProperty("disabled", true);
    expect(within(dialog).getByText(COPY.screenshotFailed)).toBeTruthy();
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "just words");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
  });

  it("is absent, not disabled, where the build has no screenshots (Production)", async () => {
    capture.available = false;
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    expect(capture.take).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).queryByText(COPY.screenshotNote)).toBeNull();
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "notes only");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
  });
});

describe("saving and receiving", () => {
  async function sendNote(user: ReturnType<typeof userEvent.setup>, text = "It broke") {
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), text);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    return dialog;
  }

  it("shows Saving…, then Saved on this device with Done, announced politely", async () => {
    let finish: (() => void) | undefined;
    const outbox = outboxStub(
      ({ report }) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              id: report.id,
              gameId: "travel-packing",
              status: "saved-local",
              sent: false,
            });
        }),
    );
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await sendNote(user);
    const send = await within(dialog).findByRole("button", { name: "Saving…" });
    expect(send).toHaveProperty("ariaBusy", "true");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(within(dialog).getByLabelText(COPY.notesLabel)).toHaveProperty("disabled", true);
    await act(async () => finish?.());
    expect(await within(dialog).findByRole("heading", { name: COPY.saved })).toBeTruthy();
    expect(within(dialog).getByText(COPY.savedText)).toBeTruthy();
    expect(within(dialog).getByRole("status").textContent).toContain("Saved on this device.");
    expect(within(dialog).queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes in place to Received when the service confirms it", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await sendNote(user);
    await within(dialog).findByRole("heading", { name: COPY.saved });
    const id = outbox.box.enqueue.mock.calls[0][0].report.id;
    outbox.receive("someone-elses-report");
    expect(within(dialog).getByRole("heading", { name: COPY.saved })).toBeTruthy();
    outbox.receive(id);
    expect(await within(dialog).findByRole("heading", { name: COPY.received })).toBeTruthy();
    expect(within(dialog).getByText(COPY.receivedText)).toBeTruthy();
    expect(within(dialog).getByRole("status").textContent).toContain("Received.");
  });

  it("toasts when it is received after the sheet was closed, and only for reports from this visit", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await sendNote(user);
    await user.click(await within(dialog).findByRole("button", { name: "Done" }));
    const id = outbox.box.enqueue.mock.calls[0][0].report.id;
    outbox.receive("older-report");
    expect(screen.queryByText(COPY.receivedToast)).toBeNull();
    outbox.receive(id);
    expect(await screen.findByText(COPY.receivedToast)).toBeTruthy();
  });

  it("Cancel while saving abandons it quietly, and a late answer does not reopen anything", async () => {
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    const outbox = outboxStub(
      (options) =>
        new Promise((resolve) => {
          signal = options.signal;
          finish = () =>
            resolve({
              id: options.report.id,
              gameId: "travel-packing",
              status: "saved-local",
              sent: false,
            });
        }),
    );
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await sendNote(user);
    await user.click(await within(dialog).findByRole("button", { name: "Cancel" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => finish?.());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(COPY.saved)).toBeNull();
  });

  it("an abort before the commit leaves the sheet closed with nothing claimed saved", async () => {
    const outbox = outboxStub(async () => {
      throw new DOMException("Local save cancelled", "AbortError");
    });
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await sendNote(user);
    await waitFor(() => expect(outbox.box.enqueue).toHaveBeenCalled());
    expect(within(dialog).queryByText(COPY.saved)).toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("when saving does not work", () => {
  const failing = (error: unknown) => outboxStub(async () => Promise.reject(error));
  const withCode = (code: string) => Object.assign(new Error(code), { code });

  it("full: says so on press, and keeps the notes", async () => {
    const user = userEvent.setup();
    mount({ outbox: failing(withCode("storage-full")) });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "keep me");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.full);
    expect(within(dialog).getByLabelText(COPY.notesLabel)).toHaveProperty("value", "keep me");
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    expect(within(dialog).queryByText(COPY.saved)).toBeNull();
  });

  it("unavailable: says nothing was saved and offers Copy my notes", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount({ outbox: failing(withCode("storage-unavailable")) });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "save my words");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.unavailable);
    await user.click(within(dialog).getByRole("button", { name: "Copy my notes" }));
    expect(writeText).toHaveBeenCalledWith("save my words");
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("Copy my notes that cannot copy stays quiet", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    mount({ outbox: failing(new Error("boom")) });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "words");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await user.click(await within(dialog).findByRole("button", { name: "Copy my notes" }));
    expect(within(dialog).getByRole("button", { name: "Copy my notes" })).toBeTruthy();
  });

  it("uncertain: asks to press Send again and reuses the same report so it cannot duplicate", async () => {
    const calls: string[] = [];
    let first = true;
    const outbox = outboxStub(async ({ report }) => {
      calls.push(report.id);
      if (first) {
        first = false;
        throw withCode("storage-uncertain");
      }
      return { id: report.id, gameId: "travel-packing", status: "saved-local", sent: false };
    });
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "maybe saved");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.uncertain);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("heading", { name: COPY.saved });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it("uncertain, then the notes change: a new report, because it is a different one", async () => {
    const calls: string[] = [];
    const outbox = outboxStub(async ({ report }) => {
      calls.push(report.id);
      throw withCode("storage-timeout");
    });
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await openSheet(user);
    const notes = within(dialog).getByLabelText(COPY.notesLabel);
    await user.type(notes, "one");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("alert");
    await user.type(notes, " two");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("unticking the screenshot after an uncertain save is also a different report", async () => {
    const calls: string[] = [];
    const outbox = outboxStub(async ({ report }) => {
      calls.push(report.id);
      throw withCode("storage-uncertain");
    });
    const user = userEvent.setup();
    mount({ outbox });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "x");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel }));
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("no outbox at all (no IndexedDB): nothing is claimed saved", async () => {
    const user = userEvent.setup();
    const create: CreateOutbox = async () => null;
    const access = accessStub();
    render(
      <ToastProvider>
        <FeedbackAccessProvider create={async () => access.access} createOutbox={create}>
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "anyone there");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.unavailable);
  });

  it("a failure while preparing the report is also reported as unsaved", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    outbox.box.enqueue.mockImplementation(async () => {
      throw new Error("whatever");
    });
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "boom");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.unavailable);
  });
});

describe("what goes into a report (privacy)", () => {
  it("holds approved codes only: no trip name, place, trip date, email, coordinate or id", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      "<div id='page'>Lisbon → Porto, Mar 3–7 · caroline@example.test · 38.7223, -9.1393</div>",
    );
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "the packing list is wrong");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    const { report } = outbox.box.enqueue.mock.calls[0][0];
    const text = JSON.stringify(report);
    expect(report).toMatchObject({
      gameId: "travel-packing",
      scene: "trip",
      input: expect.stringMatching(/^(mouse|touch)$/),
      platform: expect.stringMatching(/^(phone|tablet|desktop)$/),
      appVersion: "dev",
      notes: "the packing list is wrong",
    });
    for (const secret of [
      "Lisbon",
      "Porto",
      "Mar 3",
      "example.test",
      "38.72",
      "-9.13",
      "6c1f7d2e",
      "/trips",
    ])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/@/);
    expect(Object.keys(report).sort()).toEqual(
      [
        "appVersion",
        "breadcrumbs",
        "buildSha",
        "capturedAt",
        "gameId",
        "id",
        "input",
        "media",
        "notes",
        "platform",
        "scene",
        "seed",
        "sessionId",
        "v",
      ].sort(),
    );
    document.getElementById("page")?.remove();
  });

  it("uses the screen code of the review and staples screens too", async () => {
    pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11/review";
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "x");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.scene).toBe("review");
  });
});

describe("the outbox inside the provider", () => {
  it("starts on its own, shows what is waiting and blocked, and resumes once connected", async () => {
    const outbox = outboxStub();
    const { access } = mount({ status: { connected: false }, outbox });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalled());
    expect(outbox.box.resume).not.toHaveBeenCalled();
    access.push({ connected: true });
    await waitFor(() => expect(outbox.box.resume).toHaveBeenCalledTimes(1));
  });

  it("stops with the page and starts again when it comes back", async () => {
    const outbox = outboxStub();
    const { access } = mount({ outbox });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(outbox.box.stop).toHaveBeenCalled();
    expect(access.access.stop).toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalledTimes(2));
  });

  it("stops the outbox when the app unmounts, and one that arrives after unmounting is stopped too", async () => {
    const outbox = outboxStub();
    const { unmount } = mount({ outbox });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalled());
    unmount();
    expect(outbox.box.stop).toHaveBeenCalled();

    const late = outboxStub();
    let release: (() => void) | undefined;
    const slow: CreateOutbox = async (a, r) => {
      await new Promise<void>((resolve) => (release = resolve));
      return late.create(a, r);
    };
    const access = accessStub();
    const second = render(
      <ToastProvider>
        <FeedbackAccessProvider create={async () => access.access} createOutbox={slow}>
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(release).toBeDefined());
    second.unmount();
    await act(async () => release?.());
    await waitFor(() => expect(late.box.stop).toHaveBeenCalled());
    expect(access.access.dispose).toHaveBeenCalled();
  });

  it("a failing outbox constructor leaves feedback usable for connecting, with saving unavailable", async () => {
    const user = userEvent.setup();
    const create: CreateOutbox = async () => {
      throw new Error("no storage");
    };
    const access = accessStub();
    render(
      <ToastProvider>
        <FeedbackAccessProvider create={async () => access.access} createOutbox={create}>
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "x");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(COPY.unavailable);
  });
});

describe("outboxView and saveFailure", () => {
  it("maps the SDK's status to waiting, blocked and availability", () => {
    expect(outboxView({ ...STATUS, items: 3, blocked: 1 })).toEqual({
      waiting: 3,
      blocked: 1,
      state: "available",
    });
    expect(outboxView({ ...STATUS, state: "storage-unavailable" })).toEqual({
      waiting: 0,
      blocked: 0,
      state: "storage-unavailable",
    });
    expect(outboxView({ ...STATUS, state: "checking" }).state).toBe("available");
  });

  it.each([
    [new DOMException("x", "AbortError"), "cancelled"],
    [{ code: "storage-full" }, "full"],
    [{ code: "storage-uncertain" }, "uncertain"],
    [{ code: "storage-timeout" }, "uncertain"],
    [{ code: "storage-unavailable" }, "unavailable"],
    [new Error("anything"), "unavailable"],
    [null, "unavailable"],
  ])("%j is %s", (error, reason) => {
    expect(saveFailure(error)).toEqual({ ok: false, reason });
  });
});
