// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { stampsView } from "@/features/stamps/stamps-view";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The Home across a trip (#410), with the sample trips: Lisbon ended 2026-09-07, San Diego is 2026-10-23 to 2026-10-27.
// Every date is injected through getToday; nothing reads the clock.
function setup(today: string, laptop = true, wrap?: (base: TripsSource) => TripsSource) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    // Laptop width; motion allowed only matters to the card's own tests.
    matches: laptop && !query.includes("reduce"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  renderInApp(
    <TripsDashboard
      source={(wrap ?? ((base) => base))(
        createMemoryTripsSource(sampleLifecycleState(), { now: () => 5_000 }),
      )}
      getToday={() => today}
    />,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("TripsDashboard across a trip (#410)", () => {
  it("shows the Welcome home card for the trip that just ended, above the next trip, until it is dismissed", async () => {
    setup("2026-09-08");
    expect(await screen.findByRole("heading", { level: 2, name: "Lisbon is inked." })).toBeTruthy();
    const card = screen.getByText("WELCOME HOME");
    const tag = screen.getByText(/^NEXT TRIP/);
    expect(card.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("WELCOME HOME")).toBeNull();
    expect(screen.getByText(/^NEXT TRIP/)).toBeTruthy();
  });

  it("has no card two weeks and a day after the trip, or while a trip is still on", async () => {
    setup("2026-09-22");
    await screen.findByRole("heading", { level: 2, name: "San Diego" });
    expect(screen.queryByText("WELCOME HOME")).toBeNull();
  });

  it("is ON NOW with Day N of M while San Diego is on, and its sticker is still dashed", async () => {
    setup("2026-10-25");
    expect(await screen.findByText(/^ON NOW/)).toBeTruthy();
    expect(screen.getByText(/^Day/).textContent).toBe("Day 3 of 5");
    expect(screen.queryByText("WELCOME HOME")).toBeNull();
    const view = stampsView(sampleLifecycleState().trips, "2026-10-25", "all");
    expect(view.stickers.find((s) => s.place === "San Diego")?.upcoming).toBe(true);
  });

  it("says Last day on the end date, then inks the sticker and welcomes the person home the day after", async () => {
    const view = stampsView(sampleLifecycleState().trips, "2026-10-28", "all");
    expect(view.stickers.find((s) => s.place === "San Diego")?.upcoming).toBe(false);
    setup("2026-10-27");
    expect(await screen.findByText("Last day")).toBeTruthy();
  });

  it("welcomes the person home after San Diego, with no next trip to show", async () => {
    setup("2026-10-28");
    expect(
      await screen.findByRole("heading", { level: 2, name: "San Diego is inked." }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where to next?" })).toBeTruthy();
  });

  it("looks only at the days still ahead for the rows and the suggestions to review, and the current stay says so", async () => {
    const day = (date: string, rain: number) => ({
      date,
      stopIndex: 0,
      source: "forecast" as const,
      highC: 20,
      lowC: 10,
      precipProbability: rain,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: null,
      sunshineHours: null,
    });
    const asked = vi.fn();
    setup("2026-10-25", false, (base) => ({
      ...base,
      weather: {
        getSettings: async () => ({ weatherOptIn: true, temperatureUnit: "C" }),
        getTripWeather: async () => ({
          kind: "ready",
          stops: [
            {
              stopIndex: 0,
              status: "ok",
              days: [
                day("2026-10-23", 0.9),
                day("2026-10-24", 0.9),
                day("2026-10-25", 0.1),
                day("2026-10-26", 0.1),
                day("2026-10-27", 0.1),
              ],
            },
          ],
        }),
        listSuggestions: async () => {
          asked();
          return [];
        },
      } as unknown as TripsSource["weather"],
    }));
    const tab = await screen.findByRole("tab", { name: "Weather ALERT" });
    await userEvent.click(tab);
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("You're here");
    expect(panel.textContent).toContain("mostly dry");
    // 5 suggestions for the 25th-27th; the 23rd and 24th (rain, already over) would have made it 7.
    expect(panel.textContent).toContain("5 to review");
    expect(asked).toHaveBeenCalled();
  });

  it("keeps the current city, 'You're here' and the city's unavailable line through a full weather outage (one stop)", async () => {
    const listSuggestions = vi.fn(async () => []);
    for (const getTripWeather of [
      async () => ({ kind: "unavailable" }),
      async () => ({ kind: "ready", stops: [{ stopIndex: 0, status: "unavailable", days: [] }] }),
      async () => {
        throw new Error("down");
      },
    ]) {
      const { unmount } = renderOutage(getTripWeather, listSuggestions);
      const tab = await screen.findByRole("tab", { name: "Weather N/A" });
      await userEvent.click(tab);
      const panel = screen.getByRole("tabpanel");
      expect(panel.textContent).toContain("You're here");
      expect(panel.textContent).toContain("Weather isn't available for San Diego right now.");
      expect(panel.textContent).not.toContain("tap a place for daily");
      expect(panel.querySelector("li")?.getAttribute("data-unavailable")).toBe("true");
      unmount();
    }
    expect(listSuggestions).not.toHaveBeenCalled();
  });

  it("still says Weather is off, not an outage row, when weather is turned off", async () => {
    setup("2026-10-25", false, (base) => ({
      ...base,
      weather: {
        getSettings: async () => ({ weatherOptIn: false, temperatureUnit: "C" }),
      } as unknown as TripsSource["weather"],
    }));
    await userEvent.click(await screen.findByRole("tab", { name: "Weather Off" }));
    expect(screen.getByRole("tabpanel").textContent).not.toContain("You're here");
  });
});

function renderOutage(
  getTripWeather: () => Promise<unknown>,
  listSuggestions: () => Promise<unknown[]>,
) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const base = createMemoryTripsSource(sampleLifecycleState(), { now: () => 5_000 });
  return renderInApp(
    <TripsDashboard
      source={{
        ...base,
        weather: {
          getSettings: async () => ({ weatherOptIn: true, temperatureUnit: "C" }),
          getTripWeather,
          listSuggestions,
        } as unknown as TripsSource["weather"],
      }}
      getToday={() => "2026-10-25"}
    />,
  );
}
