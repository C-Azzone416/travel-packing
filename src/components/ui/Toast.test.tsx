// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
