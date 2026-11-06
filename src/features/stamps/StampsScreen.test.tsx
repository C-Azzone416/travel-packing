// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsScreen } from "./StampsScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/stamps" }));

function memory() {
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    today: () => "2026-10-16",
  });
}

function setup(source = memory()) {
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <StampsScreen getToday={() => "2026-10-16"} />
    </TripsSourceProvider>,
  );
  return { user, source };
}

describe("Stamps screen", () => {
  it("loads the sticker suitcase, completed totals, dashed upcoming sticker and past trip", async () => {
    setup();
    expect(screen.getByRole("region", { name: "Loading stamps" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
    expect(screen.getByText("1 inked")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lisbon, Sep 2026, 1 trip/ })).toBeTruthy();
    const upcoming = screen.getByRole("button", { name: /San Diego, Oct 2026, 1 trip/ });
    expect(upcoming.getAttribute("data-upcoming")).toBe("true");
    const totals = screen.getByLabelText("Travel totals");
    expect(within(totals).getAllByText("1", { selector: "dd" })).toHaveLength(3);
    expect(within(totals).getByText("4", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lisbon.*packed/ })).toBeTruthy();
  });

  it("selects a row or sticker and updates the reuse and open-trip actions", async () => {
    const { user, source } = setup();
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    expect(screen.getByRole("link", { name: "Reuse this list" }).getAttribute("href")).toBe(
      "/trips/new?copy=lisbon",
    );
    await user.click(screen.getByRole("button", { name: /San Diego, Oct 2026, 1 trip/ }));
    expect(screen.getByRole("link", { name: "Open trip" }).getAttribute("href")).toBe(
      "/trips/san-diego",
    );
    expect(screen.getByRole("link", { name: "Reuse this list" }).getAttribute("href")).toBe(
      "/trips/new?copy=san-diego",
    );
    expect(source.snapshot().trips).toHaveLength(2);
  });

  it("changes filters without mutating trip data", async () => {
    const { user, source } = setup();
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    const before = structuredClone(source.snapshot());
    await user.click(screen.getByRole("button", { name: "2026" }));
    expect(screen.getByText("Stickers · 2026")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All time" }));
    expect(screen.getByText("Stickers · All time")).toBeTruthy();
    expect(source.snapshot()).toEqual(before);
  });

  it("shows an honest no-past-trips state while keeping an upcoming sticker", async () => {
    const source = memory();
    const state = source.snapshot();
    setup(
      createMemoryTripsSource(
        { ...state, trips: state.trips.filter((trip) => trip.id === "san-diego") },
        { now: () => 1, today: () => "2026-10-16" },
      ),
    );
    expect(await screen.findByText("No past trips yet.")).toBeTruthy();
    expect(screen.getByText("0 inked")).toBeTruthy();
    expect(screen.getByRole("button", { name: /San Diego, Oct 2026, 1 trip/ })).toBeTruthy();
  });

  it("retries a failed read and never shows Saving", async () => {
    const base = memory();
    let fail = true;
    const source = {
      ...base,
      load: vi.fn(async () => {
        if (fail) throw new Error("down");
        return base.load();
      }),
    };
    const { user } = setup(source);
    expect(await screen.findByText("Couldn’t load your stamps.")).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  it("keeps a pending load read-only", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => (resolve = done));
    const base = memory();
    setup({ ...base, load: async () => (await gate, base.load()) });
    expect(screen.getByRole("region", { name: "Loading stamps" })).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
    await act(async () => resolve());
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
  });
});
