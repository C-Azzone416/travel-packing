// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClampedText } from "./ClampedText";

// jsdom has no layout, so the browser's size reports are played by hand.
type Callback = () => void;
const observers: { callback: Callback }[] = [];
class FakeResizeObserver {
  callback: Callback;
  constructor(callback: Callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  disconnect() {}
}

function layout(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe("ClampedText", () => {
  it("shows the text and no More button when it fits", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    layout(40, 40);
    render(<ClampedText text="Rain likely in Lisbon, Oct 3–5" />);
    act(() => observers.forEach((entry) => entry.callback()));
    expect(screen.getByText("Rain likely in Lisbon, Oct 3–5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("offers More when the text is cut, opens it, and offers Less", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    layout(80, 40);
    render(<ClampedText text="A long reason that runs past two lines on a narrow phone screen" />);
    act(() => observers.forEach((entry) => entry.callback()));
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(more);
    const less = screen.getByRole("button", { name: "Less" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".clamped")?.classList.contains("open")).toBe(true);
    // Open text is not measured again, so the button stays to close it.
    act(() => observers.forEach((entry) => entry.callback()));
    await userEvent.click(less);
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("follows a resize: a wider window removes the button", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    layout(80, 40);
    render(<ClampedText text="Reason" />);
    act(() => observers.forEach((entry) => entry.callback()));
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    layout(40, 40);
    act(() => observers.forEach((entry) => entry.callback()));
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("without a ResizeObserver it just shows the text", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<ClampedText text="Plain" className="x" />);
    expect(screen.getByText("Plain").className).toContain("x");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
