// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalSheet } from "./ModalSheet";
import { ACTION_TOAST_MS, TOAST_MS, ToastProvider, useToast, type ToastApi } from "./Toast";

let api: ToastApi;
function Capture({ onApi }: { onApi?: (value: ToastApi) => void }) {
  const toast = useToast();
  useEffect(() => onApi?.(toast), [toast, onApi]);
  return null;
}
const capture = (value: ToastApi) => {
  api = value;
};

function setup() {
  render(
    <ToastProvider>
      <Capture onApi={capture} />
    </ToastProvider>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ToastProvider", () => {
  it("throws when useToast is used without a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Capture />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it("has a polite status region and a separate assertive alert region from the start", () => {
    setup();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  });

  it("shows a plain toast for 4s in the polite region", () => {
    setup();
    act(() => api.show("Trip copied"));
    expect(screen.getByRole("status").textContent).toContain("Trip copied");
    expect(screen.queryByRole("button")).toBeNull();
    advance(TOAST_MS - 1);
    expect(screen.getByText("Trip copied")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("Trip copied")).toBeNull();
  });

  it("keeps an action toast for 8s and runs its action once, dismissing the toast", () => {
    setup();
    const onAction = vi.fn();
    act(() => api.show("Trip removed", { action: { label: "Undo", onAction } }));
    advance(TOAST_MS + 1000);
    expect(screen.getByText("Trip removed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Trip removed")).toBeNull();
  });

  it("expires an action toast after 8s", () => {
    setup();
    act(() => api.show("Trip removed", { action: { label: "Undo", onAction: () => {} } }));
    advance(ACTION_TOAST_MS);
    expect(screen.queryByText("Trip removed")).toBeNull();
  });

  it("pauses while hovered and restarts after the pointer leaves", () => {
    setup();
    act(() => api.show("Saved"));
    const toast = screen.getByText("Saved").parentElement as HTMLElement;
    fireEvent.mouseEnter(toast);
    advance(TOAST_MS * 3);
    expect(screen.getByText("Saved")).toBeTruthy();
    fireEvent.mouseLeave(toast);
    advance(TOAST_MS);
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("pauses while focused and stays paused if the pointer is still over it", () => {
    setup();
    act(() => api.show("Trip removed", { action: { label: "Undo", onAction: () => {} } }));
    const undo = screen.getByRole("button", { name: "Undo" });
    const toast = undo.parentElement as HTMLElement;
    fireEvent.focus(undo);
    fireEvent.mouseEnter(toast);
    advance(ACTION_TOAST_MS * 2);
    expect(screen.getByText("Trip removed")).toBeTruthy();
    fireEvent.blur(undo);
    advance(ACTION_TOAST_MS * 2);
    expect(screen.getByText("Trip removed")).toBeTruthy();
    fireEvent.mouseLeave(toast);
    advance(ACTION_TOAST_MS);
    expect(screen.queryByText("Trip removed")).toBeNull();
  });

  it("lasts exactly 4000ms for plain toasts and 8000ms for action toasts (the documented durations)", () => {
    expect(TOAST_MS).toBe(4000);
    expect(ACTION_TOAST_MS).toBe(8000);
    setup();
    act(() => api.show("Plain"));
    advance(3999);
    expect(screen.getByText("Plain")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("Plain")).toBeNull();
    act(() => api.show("Undoable", { action: { label: "Undo", onAction: () => {} } }));
    advance(7999);
    expect(screen.getByText("Undoable")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("Undoable")).toBeNull();
  });

  it("pauses on keyboard focus alone (no hover) and resumes on blur", () => {
    setup();
    act(() => api.show("Trip removed", { action: { label: "Undo", onAction: () => {} } }));
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.focus(undo);
    advance(8000 * 3);
    expect(screen.getByText("Trip removed")).toBeTruthy();
    fireEvent.blur(undo);
    advance(7999);
    expect(screen.getByText("Trip removed")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("Trip removed")).toBeNull();
  });

  it("a replacement toast still expires when the one it replaced was hovered", () => {
    setup();
    act(() => api.show("A"));
    fireEvent.mouseEnter(screen.getByText("A").parentElement as HTMLElement);
    act(() => api.show("B"));
    advance(3999);
    expect(screen.getByText("B")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("B")).toBeNull();
  });

  it("a replacement toast still expires when the one it replaced had keyboard focus", () => {
    setup();
    act(() => api.show("A", { action: { label: "Undo", onAction: () => {} } }));
    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    act(() => api.show("B"));
    advance(4000);
    expect(screen.queryByText("B")).toBeNull();
  });

  it("replaces the current toast and restarts the timer for the new one", () => {
    setup();
    act(() => api.show("First"));
    advance(TOAST_MS - 100);
    act(() => api.show("Second"));
    advance(TOAST_MS - 100);
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
    advance(100);
    expect(screen.queryByText("Second")).toBeNull();
  });

  it("shows errors in the assertive region until dismissed, never in the toast region", () => {
    setup();
    act(() => api.error("Couldn't save"));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    expect(screen.getByRole("status").textContent).toBe("");
    advance(TOAST_MS * 10);
    expect(screen.getByText("Couldn't save")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Couldn't save")).toBeNull();
  });

  describe("held while a sheet is open (#341)", () => {
    function Sheets({ a, b = false }: { a: boolean; b?: boolean }) {
      return (
        <>
          <ModalSheet open={a} title="First sheet" onClose={() => {}}>
            <button>One</button>
          </ModalSheet>
          <ModalSheet open={b} title="Second sheet" onClose={() => {}}>
            <button>Two</button>
          </ModalSheet>
        </>
      );
    }
    function setupSheets() {
      const view = render(
        <ToastProvider>
          <Capture onApi={capture} />
          <Sheets a={false} />
        </ToastProvider>,
      );
      const set = (a: boolean, b = false) =>
        view.rerender(
          <ToastProvider>
            <Capture onApi={capture} />
            <Sheets a={a} b={b} />
          </ToastProvider>,
        );
      return set;
    }
    const flush = () => act(async () => {});

    it("keeps a toast that arrives behind a sheet (still in the DOM) and does not expire it", async () => {
      const set = setupSheets();
      set(true);
      await flush();
      expect(document.body.hasAttribute("data-sheet-open")).toBe(true);
      act(() => api.show("Hello"));
      expect(screen.getByRole("status", { hidden: true }).textContent).toContain("Hello");
      advance(20_000);
      expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("gives the full 4s after the sheet closes", async () => {
      const set = setupSheets();
      set(true);
      await flush();
      act(() => api.show("Hello"));
      advance(20_000);
      set(false);
      await flush();
      expect(document.body.hasAttribute("data-sheet-open")).toBe(false);
      advance(TOAST_MS - 1);
      expect(screen.getByText("Hello")).toBeTruthy();
      advance(1);
      expect(screen.queryByText("Hello")).toBeNull();
    });

    it("pauses a toast already showing when a sheet opens, then restarts its time", async () => {
      const set = setupSheets();
      act(() => api.show("Early"));
      advance(TOAST_MS - 500);
      set(true);
      await flush();
      advance(20_000);
      expect(screen.getByText("Early")).toBeTruthy();
      set(false);
      await flush();
      advance(TOAST_MS - 1);
      expect(screen.getByText("Early")).toBeTruthy();
      advance(1);
      expect(screen.queryByText("Early")).toBeNull();
    });

    it("lets a newer toast replace a held one", async () => {
      const set = setupSheets();
      set(true);
      await flush();
      act(() => api.show("Old"));
      act(() => api.show("New"));
      expect(screen.queryByText("Old")).toBeNull();
      expect(screen.getByText("New")).toBeTruthy();
      set(false);
      await flush();
      advance(TOAST_MS);
      expect(screen.queryByText("New")).toBeNull();
    });

    it("holds until both of two stacked sheets are closed", async () => {
      const set = setupSheets();
      set(true, true);
      await flush();
      act(() => api.show("Stacked"));
      set(true, false);
      await flush();
      expect(document.body.hasAttribute("data-sheet-open")).toBe(true);
      advance(20_000);
      expect(screen.getByText("Stacked")).toBeTruthy();
      set(false, false);
      await flush();
      advance(TOAST_MS);
      expect(screen.queryByText("Stacked")).toBeNull();
    });

    it("starts the 8s of an action toast after the sheet closes", async () => {
      const set = setupSheets();
      set(true);
      await flush();
      act(() => api.show("Trip removed", { action: { label: "Undo", onAction: () => {} } }));
      advance(20_000);
      expect(screen.getByText("Trip removed")).toBeTruthy();
      set(false);
      await flush();
      advance(ACTION_TOAST_MS - 1);
      expect(screen.getByText("Trip removed")).toBeTruthy();
      advance(1);
      expect(screen.queryByText("Trip removed")).toBeNull();
    });

    it("never hides the error banner", async () => {
      const set = setupSheets();
      set(true);
      await flush();
      act(() => api.error("Couldn't save"));
      expect(screen.getByRole("alert", { hidden: true }).textContent).toContain("Couldn't save");
    });
  });
});
