// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LAPTOP_MIN_WIDTH, useMinWidth } from "./use-min-width";

function Probe() {
  return <p>{useMinWidth(LAPTOP_MIN_WIDTH) ? "laptop" : "narrow"}</p>;
}

const real = window.matchMedia;
afterEach(() => {
  window.matchMedia = real;
});

describe("useMinWidth", () => {
  it("is false where matchMedia does not exist", () => {
    // @ts-expect-error jsdom has no matchMedia
    window.matchMedia = undefined;
    render(<Probe />);
    expect(screen.getByText("narrow")).toBeTruthy();
  });

  it("follows the media query as the window resizes, and stops listening on unmount", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;
    const view = render(<Probe />);
    expect(screen.getByText("narrow")).toBeTruthy();
    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(screen.getByText("laptop")).toBeTruthy();
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it("uses the one breakpoint of the redesign", () => {
    expect(LAPTOP_MIN_WIDTH).toBe(1024);
  });
});
