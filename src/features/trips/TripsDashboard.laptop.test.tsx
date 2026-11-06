// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { routeSignature, tripRoutePoints } from "@/domain/trip-route";
import { sampleLifecycleState } from "./fixtures";
import type { HomeMaps } from "./home-map-types";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const TODAY = () => "2026-10-16";

function laptop(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    set(next: boolean) {
      media.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  refresh.mockClear();
});

const memory = () => createMemoryTripsSource(sampleLifecycleState(), { now: () => 5_000 });

function setup(source: TripsSource = memory(), maps?: HomeMaps) {
  renderInApp(<TripsDashboard source={source} getToday={TODAY} maps={maps} />);
}

describe("TripsDashboard at laptop width", () => {
  it("shows the laptop Home for the next trip instead of the ledger hero", async () => {
    laptop(true);
    setup();
    expect(await screen.findByRole("heading", { level: 2, name: "San Diego" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /In the bag/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your travel ledger" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Trip views" })).toBeNull();
    expect(screen.getByRole("link", { name: /Continue packing: San Diego/ })).toBeTruthy();
  });

  it("keeps today's Home below 1024px, and switches when the window crosses it", async () => {
    const media = laptop(false);
    setup();
    expect(await screen.findByRole("heading", { name: "Your travel ledger" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /In the bag/ })).toBeNull();
    act(() => media.set(true));
    expect(await screen.findByRole("heading", { name: /In the bag/ })).toBeTruthy();
  });

  it("shows the server-drawn map only while it matches the trip's route", async () => {
    laptop(true);
    const trip = sampleLifecycleState().trips[0];
    const signature = routeSignature(tripRoutePoints(trip), trip.travelMode);
    const good: HomeMaps = {
      [trip.id]: { signature, node: <svg role="img" aria-label="Drawn map" /> },
    };
    const { unmount } = renderInApp(
      <TripsDashboard source={memory()} getToday={TODAY} maps={good} />,
    );
    expect(await screen.findByRole("img", { name: "Drawn map" })).toBeTruthy();
    unmount();
    const stale: HomeMaps = {
      [trip.id]: { signature: "old", node: <svg role="img" aria-label="Old map" /> },
    };
    renderInApp(<TripsDashboard source={memory()} getToday={TODAY} maps={stale} />);
    expect(await screen.findByRole("img", { name: "Route map unavailable" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Old map" })).toBeNull();
  });

  it("opens Past & archive from ?view=archive", async () => {
    laptop(true);
    window.history.replaceState(null, "", "/?view=archive");
    setup();
    expect(await screen.findByRole("heading", { name: "Past trips & archive" })).toBeTruthy();
  });

  it("opens Past & archive from the trip menu without a reload", async () => {
    laptop(true);
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "More actions for San Diego" }));
    await user.click(screen.getByRole("menuitem", { name: "Past trips & archive" }));
    expect(await screen.findByRole("heading", { name: "Past trips & archive" })).toBeTruthy();
  });

  it("asks for fresh maps after a change (archive) and after a route save", async () => {
    laptop(true);
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "More actions for San Diego" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("opens the Edit trip sheet and the remove confirmation from the trip menu", async () => {
    laptop(true);
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "More actions for San Diego" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(await screen.findByRole("button", { name: "Remove trip" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "More actions for San Diego" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("shows the weather off block when weather is off, and Usual rows for a far trip", async () => {
    laptop(true);
    const base = memory();
    const off: TripsSource = {
      ...base,
      weather: {
        getSettings: async () => ({ weatherOptIn: false, temperatureUnit: "F" }),
      } as unknown as TripsSource["weather"],
    };
    setup(off);
    expect(await screen.findByTestId("weather-off")).toBeTruthy();
  });

  it("shows tiles and a rain outline for a near trip with a rainy forecast", async () => {
    laptop(true);
    const base = memory();
    const day = (date: string, rain: number) => ({
      date,
      stopIndex: 0,
      source: "forecast" as const,
      highC: 15,
      lowC: 10,
      precipProbability: rain,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: 3,
      sunshineHours: 5,
    });
    const source: TripsSource = {
      ...base,
      weather: {
        getSettings: async () => ({ weatherOptIn: true, temperatureUnit: "F" }),
        getTripWeather: async () => ({
          kind: "ready",
          stops: [
            {
              stopIndex: 0,
              status: "ok",
              days: [day("2026-10-23", 0.8), day("2026-10-24", 0.1)],
            },
          ],
        }),
      } as unknown as TripsSource["weather"],
    };
    setup(source);
    const button = await screen.findByRole("button", { name: /San Diego · 59°\/50°/ });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).toMatch(/\d+ to review/);
  });
});
