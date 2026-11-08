// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { INK_MS, WelcomeHomeCard } from "./WelcomeHomeCard";
import { WELCOME_SEEN_KEY, welcomeHomeModel, type WelcomeHomeModel } from "./welcome-home";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

const model = welcomeHomeModel(
  [sampleLifecycleState().trips[1] as LifecycleTrip],
  "2026-09-08",
) as WelcomeHomeModel;

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sticker = () => document.querySelector("[data-shape]") as HTMLElement;

describe("WelcomeHomeCard", () => {
  it("shows the eyebrow, title, line, See stamps to the trip, and Dismiss", () => {
    motion(true);
    render(<WelcomeHomeCard model={model} />);
    expect(screen.getByText("WELCOME HOME")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Lisbon is inked." })).toBeTruthy();
    expect(screen.getByText(model.line)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See stamps" }).getAttribute("href")).toBe(
      `/stamps?trip=${model.tripId}`,
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("inks the sticker after a frame, and announces it once the 600 ms are over", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    motion(false);
    render(<WelcomeHomeCard model={model} />);
    // Painted dashed first, and silent.
    expect(sticker().getAttribute("data-upcoming")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(sticker().getAttribute("data-upcoming")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(INK_MS);
    });
    expect(screen.getByRole("status").textContent).toBe(model.announcement);
  });

  it("is solid and announced at once under reduced motion", () => {
    motion(true);
    render(<WelcomeHomeCard model={model} />);
    expect(sticker().getAttribute("data-upcoming")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(model.announcement);
  });

  it("is solid when matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<WelcomeHomeCard model={model} />);
    expect(sticker().getAttribute("data-upcoming")).toBe("true");
  });

  it("hides on Dismiss, keeps the trip in storage, and does not come back", async () => {
    motion(true);
    const user = userEvent.setup();
    const { unmount } = render(<WelcomeHomeCard model={model} />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("WELCOME HOME")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(WELCOME_SEEN_KEY) ?? "[]")).toEqual([
      model.tripId,
    ]);
    unmount();
    render(<WelcomeHomeCard model={model} />);
    expect(screen.queryByText("WELCOME HOME")).toBeNull();
  });

  it("remembers the trip when the person opens Stamps from the card", async () => {
    motion(true);
    const user = userEvent.setup();
    render(<WelcomeHomeCard model={model} />);
    await user.click(screen.getByRole("link", { name: "See stamps" }));
    expect(JSON.parse(window.localStorage.getItem(WELCOME_SEEN_KEY) ?? "[]")).toEqual([
      model.tripId,
    ]);
  });

  it("shows another trip's card even when an earlier one was dismissed", () => {
    motion(true);
    window.localStorage.setItem(WELCOME_SEEN_KEY, JSON.stringify(["another-trip"]));
    render(<WelcomeHomeCard model={model} />);
    expect(screen.getByText("WELCOME HOME")).toBeTruthy();
  });
});
