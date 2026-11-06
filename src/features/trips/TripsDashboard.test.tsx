// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push, refresh }),
}));

const TODAY = () => "2026-10-16";

function phone() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  phone();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

function memory(initial: LifecycleState = sampleLifecycleState()) {
  return createMemoryTripsSource(initial, { now: () => 5_000 });
}

function setup(
  initial: LifecycleState = sampleLifecycleState(),
  wrap?: (source: ReturnType<typeof memory>) => TripsSource,
) {
  const base = memory(initial);
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
  return { base, source, user };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function ready() {
  await screen.findByRole("tablist", { name: "Home sections" });
}

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: "More actions for San Diego" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("loading and errors", () => {
  it("keeps the loading skeleton quiet, then opens the phone Home", async () => {
    const gate = deferred<LifecycleState>();
    const base = memory();
    renderInApp(<TripsDashboard source={{ ...base, load: () => gate.promise }} getToday={TODAY} />);
    expect(screen.getByRole("region", { name: "Loading trips" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(document.querySelectorAll(".skeleton-card")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("");
    await act(async () => gate.resolve(await base.load()));
    await ready();
    expect(screen.queryByRole("region", { name: "Loading trips" })).toBeNull();
  });

  it("offers Try again after a failed read and recovers without saying Saving", async () => {
    const base = memory();
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockImplementation(base.load);
    const user = userEvent.setup();
    renderInApp(<TripsDashboard source={{ ...base, load }} getToday={TODAY} />);
    expect(await screen.findByText("Couldn’t load your trips.")).toBeTruthy();
    expect(screen.getByText("Nothing was changed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("ignores reads that settle after unmount", async () => {
    const gate = deferred<LifecycleState>();
    const base = memory();
    const view = renderInApp(
      <TripsDashboard source={{ ...base, load: () => gate.promise }} getToday={TODAY} />,
    );
    view.unmount();
    await act(async () => gate.resolve(await base.load()));
    const failure = deferred<LifecycleState>();
    const second = renderInApp(
      <TripsDashboard source={{ ...base, load: () => failure.promise }} getToday={TODAY} />,
    );
    second.unmount();
    await act(async () => failure.reject(new Error("late")));
  });
});

describe("the redesigned phone Home", () => {
  it("replaces the ledger hero with the next-trip tag and four URL-backed panels", async () => {
    const { user } = setup();
    await ready();
    expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your travel ledger" })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    await user.click(screen.getByRole("tab", { name: /^Future/ }));
    expect(window.location.search).toBe("?tab=future");
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("home-phone-panel-future");
  });

  it("starts on the panel named in the URL and opens the Edit trip sheet", async () => {
    window.history.replaceState(null, "", "/?tab=stamps");
    const { user } = setup();
    await ready();
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("home-phone-panel-stamps");
    await user.click(screen.getByRole("button", { name: "More actions for San Diego" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Past trips & archive in the tag menu opens the retained history view", async () => {
    const { user } = setup();
    await ready();
    await choose(user, "Past trips & archive");
    expect(await screen.findByRole("heading", { name: "Past trips & archive" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Lisbon" })).toBeTruthy();
  });
});

describe("phone Home mutations", () => {
  it("Archive waits for the write, then leaves the trip recoverable in history", async () => {
    const gate = deferred<LifecycleState>();
    const { base, user } = setup(undefined, (source) => ({
      ...source,
      archive: () => gate.promise,
    }));
    await ready();
    await choose(user, "Archive");
    expect(
      (screen.getByRole("button", { name: "More actions for San Diego" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(base.snapshot().trips.find((trip) => trip.id === "san-diego")?.archived).toBe(false);
    await act(async () => gate.resolve(await base.archive("san-diego")));
    expect(await screen.findByText("No upcoming trips.")).toBeTruthy();
    expect(base.snapshot().trips.find((trip) => trip.id === "san-diego")?.archived).toBe(true);
    await user.click(screen.getByRole("button", { name: /Past & archive/ }));
    expect(screen.getByRole("article", { name: "San Diego" })).toBeTruthy();
  });

  it("an Archive failure keeps Home and the save retry can finish it", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      archive: vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockImplementation((id: string) => base.archive(id)),
    }));
    await ready();
    await choose(user, "Archive");
    expect(await screen.findByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    expect(await screen.findByText("No upcoming trips.")).toBeTruthy();
  });

  it("Remove is confirmed, offers Undo, and restores the exact trip", async () => {
    const { base, user } = setup();
    await ready();
    const before = base.snapshot().trips[0];
    await choose(user, "Remove");
    const dialog = screen.getByRole("dialog", { name: "Remove San Diego?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove trip" }));
    expect(await screen.findByText("San Diego removed")).toBeTruthy();
    expect(base.snapshot().trips.some((trip) => trip.id === "san-diego")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(base.snapshot().trips.find((trip) => trip.id === "san-diego")).toEqual(before),
    );
    expect(await screen.findByText("San Diego restored")).toBeTruthy();
  });

  it("Cancel and Escape close Remove without changing data", async () => {
    const { base, user } = setup();
    await ready();
    const before = base.snapshot();
    await choose(user, "Remove");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(base.snapshot()).toBe(before);
    await choose(user, "Remove");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(base.snapshot()).toBe(before);
  });
});

describe("empty and archive-only states", () => {
  it("keeps the ledger controls only when there is no next trip", async () => {
    const state = sampleLifecycleState();
    state.trips = [];
    const { user } = setup(state);
    expect(await screen.findByText("No upcoming trips.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your travel ledger" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Past & archive/ }));
    expect(screen.getByText("No past or archived trips yet.")).toBeTruthy();
    expect(screen.getByText("Nothing recently deleted.")).toBeTruthy();
  });

  it("opens history directly from ?view=archive", async () => {
    window.history.replaceState(null, "", "/?view=archive");
    setup();
    expect(await screen.findByRole("heading", { name: "Past trips & archive" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Lisbon" })).toBeTruthy();
  });
});
