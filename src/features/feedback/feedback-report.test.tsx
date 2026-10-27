// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableFeedback, OutboxStatus } from "@masra91/framebriar/browser/durable-feedback";
import { ToastProvider } from "@/components/ui/Toast";
import { createFakeFeedbackServer, createMemoryIdb } from "@/test/fake-feedback-server";
import { createFakeOutbox, OUTBOX_STATUS as STATUS } from "@/test/fake-outbox";
import {
  FeedbackAccessProvider,
  outboxView,
  saveFailure,
  type CreateOutbox,
} from "./FeedbackAccess";
import { FeedbackButton } from "./FeedbackButton";
import { FeedbackSettings } from "./FeedbackSettings";
import { EDITOR_COPY } from "./ScreenshotEditor";
import { COPY, SCREENSHOT_SEND_LIMIT_BYTES, SHOT_PROBLEM_COPY } from "./FeedbackSheet";

let pathname = "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const capture = vi.hoisted(() => ({ available: true, take: vi.fn() }));
vi.mock("@/features/feedback/screenshot-capture", () => ({
  get screenshotCaptureAvailable() {
    return capture.available;
  },
  // The tests give a Blob for a picture, null for an ordinary failure, or the string "private" for a private surface being open.
  captureScreenshot: async () => {
    const taken = await capture.take();
    if (taken === "private") return { kind: "private" };
    return taken ? { kind: "ok", blob: taken } : { kind: "failed" };
  },
}));

// Compositing needs a real canvas, which jsdom does not have: the tests decide what it returns and see what it was given.
const composite = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./annotation-composite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./annotation-composite")>()),
  compositeMarks: (...args: unknown[]) => composite.run(...args),
}));

type Enqueue = DurableFeedback["enqueue"];
const outboxStub = createFakeOutbox;

/** A fake server that says "connected" unless told otherwise: the Feedback button is only on for a connected account. */
function serverStub(initial: Parameters<typeof createFakeFeedbackServer>[0] = {}) {
  return createFakeFeedbackServer({ status: "connected", ...initial });
}

function providerProps(server: ReturnType<typeof serverStub>, create: CreateOutbox) {
  return {
    enabled: true as const,
    fetchImpl: server.fetch,
    createOutbox: create,
    indexedDBImpl: createMemoryIdb().factory,
    createChannel: () => null,
  };
}

function mount(
  options: {
    server?: Parameters<typeof createFakeFeedbackServer>[0];
    outbox?: ReturnType<typeof createFakeOutbox>;
  } = {},
) {
  const server = serverStub(options.server);
  const outbox = options.outbox ?? outboxStub();
  const view = render(
    <ToastProvider>
      <FeedbackAccessProvider {...providerProps(server, outbox.create)}>
        <FeedbackButton />
      </FeedbackAccessProvider>
    </ToastProvider>,
  );
  return { ...view, server, outbox };
}

/** The status route is asked again on pageshow; this is how a test makes the server's new answer reach the page. */
const refresh = () => act(async () => void window.dispatchEvent(new Event("pageshow")));

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
    const { server } = mount({ server: { status: "not-connected" } });
    await waitFor(() => expect(feedbackButton()).toHaveProperty("disabled", true));
    server.state.status = "connected";
    await refresh();
    await waitFor(() => expect(feedbackButton()).toHaveProperty("disabled", false));
  });

  it.each([
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
  it("is ticked by default with the editor and the plain warning", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openSheet(user);
    const box = within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel });
    expect(box).toHaveProperty("checked", true);
    expect(within(dialog).getByRole("img", { name: EDITOR_COPY.canvasLabel })).toBeTruthy();
    expect(within(dialog).getByText(COPY.screenshotHint)).toBeTruthy();
    expect(
      within(dialog).getByText(`${COPY.screenshotNote} ${COPY.screenshotDrawNote}`),
    ).toBeTruthy();
  });

  it("is taken before the sheet opens", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    expect(capture.take).toHaveBeenCalledTimes(1);
  });

  it("unticking removes the editor and sends the notes only", async () => {
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

  it("when the capture fails there is one plain line in place of the checkbox group, and the notes still send", async () => {
    capture.take.mockResolvedValue(null);
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    // No disabled checkbox, no editor: one muted line with an info mark (not a warning).
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    const line = dialog.querySelector(".feedback-no-shot");
    expect(line?.textContent).toBe(`ⓘ ${COPY.screenshotFailed}`);
    expect(line?.closest("[role=alert]")).toBeNull();
    expect(within(dialog).getByRole("status").textContent).toBe(COPY.screenshotFailed);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "just words");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
  });

  it("when something private is open it says so, plainly, in place of the checkbox group, and the notes still send", async () => {
    capture.take.mockResolvedValue("private");
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    expect(COPY.screenshotPrivate).toBe(
      "No screenshot this time: something private is open on this screen. You can still send your notes.",
    );
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(dialog.querySelector(".feedback-no-shot")?.textContent).toBe(
      `ⓘ ${COPY.screenshotPrivate}`,
    );
    expect(within(dialog).queryByText(COPY.screenshotFailed)).toBeNull();
    expect(within(dialog).getByRole("status").textContent).toBe(COPY.screenshotPrivate);
    // Notes stay first, and Cancel and Send are unchanged.
    expect(within(dialog).getByLabelText(COPY.notesLabel)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "private thing open");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
    expect(outbox.box.enqueue.mock.calls[0][0].media).toBeNull();
  });

  it("pins the sendable screenshot size to 4,000,000 bytes, under Vercel's ~4.5 MB request body limit", () => {
    // A literal on purpose: the other tests read the constant, so only this one fails if the number drifts.
    expect(SCREENSHOT_SEND_LIMIT_BYTES).toBe(4_000_000);
  });

  it("a screenshot over the sendable size stays ticked with the alert, is not sent or shrunk, and unticking sends the notes", async () => {
    const big = SCREENSHOT_SEND_LIMIT_BYTES + 500_000;
    capture.take.mockResolvedValue(new Blob([new Uint8Array(big)], { type: "image/png" }));
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    const box = within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel });
    expect(box).toHaveProperty("checked", true);
    expect(box).toHaveProperty("disabled", false);
    const alert = within(dialog).getByText(SHOT_PROBLEM_COPY.alone(big));
    expect(alert.textContent).toContain("4.5 MB, over the 4.0 MB limit");
    // The editor tools are hidden when there is nothing to draw on.
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(within(dialog).queryByRole("img")).toBeNull();

    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "big screen");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(outbox.box.enqueue).not.toHaveBeenCalled();
    expect(within(dialog).getByText(SHOT_PROBLEM_COPY.alone(big))).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);

    await user.click(box);
    expect(within(dialog).queryByText(SHOT_PROBLEM_COPY.alone(big))).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
    expect(outbox.box.enqueue.mock.calls[0][0].media).toBeNull();
  });

  it("a screenshot of exactly the sendable size is offered; one byte more is over", async () => {
    capture.take.mockResolvedValue(
      new Blob([new Uint8Array(SCREENSHOT_SEND_LIMIT_BYTES)], { type: "image/png" }),
    );
    const user = userEvent.setup();
    const first = mount();
    const dialog = await openSheet(user);
    expect(within(dialog).getByRole("radiogroup", { name: EDITOR_COPY.inkGroup })).toBeTruthy();
    expect(within(dialog).queryByText(/over the 4\.0 MB limit/)).toBeNull();
    first.unmount();

    capture.take.mockResolvedValue(
      new Blob([new Uint8Array(SCREENSHOT_SEND_LIMIT_BYTES + 1)], { type: "image/png" }),
    );
    mount();
    const atLimit = await openSheet(user);
    expect(within(atLimit).getByText(/over the 4\.0 MB limit/)).toBeTruthy();
    expect(within(atLimit).queryByRole("radiogroup")).toBeNull();
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

  it("unavailable with a screenshot ticked: hints at unticking it, and the hint goes away without the screenshot", async () => {
    const user = userEvent.setup();
    mount({ outbox: failing(withCode("storage-unavailable")) });
    const dialog = await openSheet(user);
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), "with picture");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByText(COPY.tryWithoutScreenshot)).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel }));
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).queryByText(COPY.tryWithoutScreenshot)).toBeNull();
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
    render(
      <ToastProvider>
        <FeedbackAccessProvider {...providerProps(serverStub(), create)}>
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
  it("fetches the code that prepares a report as soon as the app is up, so saving works with no connection", async () => {
    const preload = vi.fn(async () => undefined);
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          {...providerProps(serverStub(), outboxStub().create)}
          preload={preload}
        >
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
  });

  it("a failing preload changes nothing", async () => {
    render(
      <ToastProvider>
        <FeedbackAccessProvider
          {...providerProps(serverStub(), outboxStub().create)}
          preload={async () => Promise.reject(new Error("offline"))}
        >
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(feedbackButton().hasAttribute("disabled")).toBe(false));
  });

  it("starts on its own, shows what is waiting and blocked, and resumes once connected", async () => {
    const outbox = outboxStub();
    const { server } = mount({ server: { status: "not-connected" }, outbox });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalled());
    expect(outbox.box.resume).not.toHaveBeenCalled();
    server.state.status = "connected";
    await refresh();
    await waitFor(() => expect(outbox.box.resume).toHaveBeenCalledTimes(1));
  });

  it("stops with the page and starts again when it comes back", async () => {
    const outbox = outboxStub();
    mount({ outbox });
    await waitFor(() => expect(outbox.box.start).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(outbox.box.stop).toHaveBeenCalled();
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
    const slow: CreateOutbox = async (options) => {
      await new Promise<void>((resolve) => (release = resolve));
      return late.create(options);
    };
    const second = render(
      <ToastProvider>
        <FeedbackAccessProvider {...providerProps(serverStub(), slow)}>
          <FeedbackButton />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(release).toBeDefined());
    second.unmount();
    await act(async () => release?.());
    await waitFor(() => expect(late.box.stop).toHaveBeenCalled());
  });

  it("a failing outbox constructor leaves feedback usable for connecting, with saving unavailable", async () => {
    const user = userEvent.setup();
    const create: CreateOutbox = async () => {
      throw new Error("no storage");
    };
    render(
      <ToastProvider>
        <FeedbackAccessProvider {...providerProps(serverStub(), create)}>
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

describe("marking the screenshot", () => {
  const BOX = { left: 0, top: 0, width: 400, height: 800 };
  const composed = () => new Blob([new Uint8Array(1234)], { type: "image/png" });
  const surface = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    lineCap: "",
    lineJoin: "",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
  };

  beforeEach(() => {
    composite.run.mockReset();
    composite.run.mockImplementation(async () => ({ kind: "ok", blob: composed() }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      surface as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      ...BOX,
      right: 400,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  /** Loads the preview picture (800x1600, shown at half size) and draws one mark with the mouse. */
  function draw(dialog: HTMLElement, y = 100) {
    const image = dialog.querySelector(".shot-image") as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: 1600, configurable: true });
    fireEvent.load(image);
    const canvas = within(dialog).getByRole("img", { name: EDITOR_COPY.canvasLabel });
    const pointer = { pointerId: 1, pointerType: "mouse", button: 0 };
    fireEvent.pointerDown(canvas, { ...pointer, clientX: 50, clientY: y });
    fireEvent.pointerMove(canvas, { ...pointer, clientX: 120, clientY: y + 40 });
    fireEvent.pointerUp(canvas, { ...pointer, clientX: 200, clientY: y + 40 });
  }

  async function writeNote(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    text = "Look here",
  ) {
    await user.type(within(dialog).getByLabelText(COPY.notesLabel), text);
  }

  it("queues the PNG with the marks on it, made from the reviewed picture and these strokes", async () => {
    const user = userEvent.setup();
    const reviewed = png();
    capture.take.mockResolvedValue(reviewed);
    const { outbox } = mount();
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);

    expect(composite.run).toHaveBeenCalledTimes(1);
    const [source, strokes] = composite.run.mock.calls[0];
    expect(source).toBe(reviewed);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points[0]).toEqual({ x: 100, y: 200 });
    const { report, media } = outbox.box.enqueue.mock.calls[0][0];
    expect(report.media).toMatchObject({ type: "image/png", bytes: 1234 });
    expect(media?.size).toBe(1234);
  });

  it("queues the reviewed picture itself, untouched, when nothing was drawn", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(composite.run).not.toHaveBeenCalled();
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toMatchObject({ bytes: 64 });
  });

  it("sends text only when unticked, whatever was drawn, and brings the marks back when ticked again", async () => {
    const user = userEvent.setup();
    const { outbox } = mount();
    const dialog = await openSheet(user);
    draw(dialog);
    expect(within(dialog).getByText("1 mark.")).toBeTruthy();
    const box = within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel });
    await user.click(box);
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    await user.click(box);
    expect(within(dialog).getByText("1 mark.")).toBeTruthy();
    await user.click(box);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(composite.run).not.toHaveBeenCalled();
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
    expect(outbox.box.enqueue.mock.calls[0][0].media).toBeNull();
  });

  it("does not send a picture with marks over the limit, says so, and recovers with Clear drawing", async () => {
    const user = userEvent.setup();
    const reviewed = png();
    capture.take.mockResolvedValue(reviewed);
    composite.run.mockResolvedValue({
      kind: "ok",
      blob: new Blob([new Uint8Array(SCREENSHOT_SEND_LIMIT_BYTES + 200_000)], {
        type: "image/png",
      }),
    });
    const { outbox } = mount();
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    const message = SHOT_PROBLEM_COPY.marks(SCREENSHOT_SEND_LIMIT_BYTES + 200_000);
    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(message).toContain("4.2 MB, over the 4.0 MB limit");
    expect(outbox.box.enqueue).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(COPY.notesLabel)).toHaveProperty("value", "Look here");
    expect(within(dialog).getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);

    // Changing the marks is the way out: the old message goes, and the unmarked picture is what is sent.
    await user.click(within(dialog).getByRole("button", { name: "Clear drawing" }));
    expect(within(dialog).queryByText(message)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toMatchObject({ bytes: 64 });
  });

  it("does not send when the marks cannot be added, keeps the notes, and unticking sends them", async () => {
    const user = userEvent.setup();
    composite.run.mockResolvedValue({ kind: "failed" });
    const { outbox } = mount();
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText(SHOT_PROBLEM_COPY.failed)).toBeTruthy();
    expect(outbox.box.enqueue).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(COPY.notesLabel)).toHaveProperty("value", "Look here");

    await user.click(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel }));
    expect(within(dialog).queryByText(SHOT_PROBLEM_COPY.failed)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(outbox.box.enqueue.mock.calls[0][0].report.media).toBeNull();
  });

  it("turns the tools off while saving", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const outbox = createFakeOutbox(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ id: "x", gameId: "travel-packing", status: "saved-local", sent: false });
        }),
    );
    mount({ outbox });
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("button", { name: "Saving…" });
    expect(within(dialog).getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "Clear drawing" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => release());
  });

  it("opens each sheet clean: cancelling throws the marks away", async () => {
    const user = userEvent.setup();
    mount();
    const first = await openSheet(user);
    draw(first);
    expect(within(first).getByText("1 mark.")).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "Cancel" }));
    const second = await openSheet(user);
    expect(within(second).getByText(EDITOR_COPY.hint)).toBeTruthy();
    expect(within(second).getByRole("button", { name: "Clear drawing" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("prepares a new report when the marks change after a save that could not be confirmed", async () => {
    const user = userEvent.setup();
    const outbox = createFakeOutbox();
    outbox.box.enqueue.mockRejectedValueOnce(new Error("unconfirmed"));
    mount({ outbox });
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await within(dialog).findByRole("alert");
    expect(composite.run).toHaveBeenCalledTimes(1);
    draw(dialog, 300);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(COPY.saved);
    expect(composite.run).toHaveBeenCalledTimes(2);
    expect(composite.run.mock.calls[1][1]).toHaveLength(2);
  });

  it("puts a visible alert on the picture group, not the whole sheet, and keeps Cancel and Send in the dialog footer", async () => {
    const user = userEvent.setup();
    composite.run.mockResolvedValue({ kind: "failed" });
    mount();
    const dialog = await openSheet(user);
    draw(dialog);
    await writeNote(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    const alert = (await within(dialog).findByText(SHOT_PROBLEM_COPY.failed)).closest(
      "[role=alert]",
    );
    expect(alert?.closest(".feedback-shot")).toBeTruthy();
    const footer = dialog.querySelector(".modal-actions");
    expect(footer?.contains(within(dialog).getByRole("button", { name: "Send" }))).toBe(true);
    expect(footer?.contains(within(dialog).getByRole("button", { name: "Cancel" }))).toBe(true);
    expect(footer?.closest(".feedback-form")).toBeNull();
  });
});

describe("the Settings screenshot (#273)", () => {
  it("says what was left out, under the preview, only when the picture is of Settings", async () => {
    const user = userEvent.setup();
    pathname = "/settings";
    mount();
    const dialog = await openSheet(user);
    const disclosure = within(dialog).getByText(COPY.settingsDisclosure);
    expect(disclosure.textContent).toBe(
      "Your account email and any invitation or password field are left out of this screenshot.",
    );
    // Before the existing note and the drawing note.
    const note = within(dialog).getByText(`${COPY.screenshotNote} ${COPY.screenshotDrawNote}`);
    expect(
      disclosure.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is not said on other screens", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openSheet(user);
    expect(within(dialog).queryByText(COPY.settingsDisclosure)).toBeNull();
    expect(
      within(dialog).getByText(`${COPY.screenshotNote} ${COPY.screenshotDrawNote}`),
    ).toBeTruthy();
  });

  it("is not said when there is no picture, or when it is unticked", async () => {
    const user = userEvent.setup();
    pathname = "/settings";
    mount();
    const dialog = await openSheet(user);
    await user.click(within(dialog).getByRole("checkbox", { name: COPY.screenshotLabel }));
    expect(within(dialog).queryByText(COPY.settingsDisclosure)).toBeNull();
  });
});

describe("the Send feedback action in the Settings card (#273)", () => {
  function mountBoth(status: "connected" | "not-connected" | "expired" = "connected") {
    const server = serverStub({ status });
    const outbox = outboxStub();
    pathname = "/settings";
    render(
      <ToastProvider>
        <FeedbackAccessProvider {...providerProps(server, outbox.create)}>
          <FeedbackButton />
          <FeedbackSettings />
        </FeedbackAccessProvider>
      </ToastProvider>,
    );
    return { server, outbox };
  }

  const cardAction = () =>
    screen
      .getAllByRole("button", { name: "Send feedback" })
      .find((button) => button.classList.contains("feedback-send-action"));

  it("is in the card when connected, before Disconnect, next to the header button with the same name", async () => {
    mountBoth();
    await waitFor(() => expect(cardAction()).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "Send feedback" })).toHaveLength(2);
    const row = cardAction()!.parentElement!;
    expect([...row.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Send feedback",
      "Disconnect",
    ]);
  });

  it("opens the same sheet as the header button, and focus returns to the control that opened it", async () => {
    const user = userEvent.setup();
    mountBoth();
    await waitFor(() => expect(cardAction()).toBeTruthy());
    await user.click(cardAction()!);
    const dialog = await screen.findByRole("dialog", { name: "Send feedback" });
    expect(capture.take).toHaveBeenCalledTimes(1);
    // Nothing was captured until it was pressed, and one press makes one sheet.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(cardAction());

    const header = screen
      .getAllByRole("button", { name: "Send feedback" })
      .find((button) => button.classList.contains("feedback-button"))!;
    await user.click(header);
    await screen.findByRole("dialog", { name: "Send feedback" });
    expect(capture.take).toHaveBeenCalledTimes(2);
  });

  it("is not rendered when the person cannot send (no dead control), and the header button is dimmed", async () => {
    mountBoth("not-connected");
    await waitFor(() => expect(screen.getByLabelText("Invitation")).toBeTruthy());
    expect(cardAction()).toBeUndefined();
    const buttons = screen.getAllByRole("button", { name: "Send feedback" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveProperty("disabled", true);
  });

  it.each(["expired"] as const)("is not rendered when the enrollment is %s", async (status) => {
    mountBoth(status);
    await waitFor(() => expect(screen.getByText("Expired")).toBeTruthy());
    expect(cardAction()).toBeUndefined();
  });
});
