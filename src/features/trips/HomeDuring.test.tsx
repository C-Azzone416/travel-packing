// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import { HomeLaptop } from "./HomeLaptop";
import { HomePhone } from "./HomePhone";
import type { CityWeather } from "./home-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

// The Home while the trip is on (#410): ON NOW, the Day N of M badge, "You're here", Open list. The clock is a parameter.
const place = (city: string): SampleLocation => ({
  id: city.toLowerCase(),
  city,
  region: "",
  country: "",
  countryCode: "PT",
  label: city,
});
const stay = (city: string, arrive: string, leave: string): TripStop => ({
  location: place(city),
  arrive,
  leave,
});
const trip = (): LifecycleTrip =>
  ({
    ...sampleLifecycleState().trips[0],
    id: "t1",
    start: "2027-03-14",
    end: "2027-03-24",
    stops: [stay("Lisbon", "2027-03-14", "2027-03-17"), stay("Porto", "2027-03-17", "2027-03-24")],
    origin: null,
    name: null,
    ready: false,
  }) as LifecycleTrip;

const row = (name: string, stopIndex: number, here: boolean): CityWeather => ({
  stopIndex,
  city: name,
  range: "70°/54°",
  summary: "mostly dry",
  source: "forecast",
  alert: false,
  condition: null,
  tiles: [],
  more: 0,
  here,
});
const WEATHER = { phase: "ready" as const, city: [row("Porto", 1, true), row("Lisbon", 0, false)] };

const handlers = () => ({
  onEdit: vi.fn(),
  onArchive: vi.fn(),
  onRemove: vi.fn(),
  onOpenArchive: vi.fn(),
});
const laptop = (today: string, weather: Parameters<typeof HomeLaptop>[0]["weather"]) =>
  render(
    <HomeLaptop
      trip={trip()}
      later={[]}
      today={today}
      weather={weather}
      map={null}
      busy={false}
      {...handlers()}
    />,
  );
const phone = (today: string) => {
  const state = sampleLifecycleState();
  return render(
    <HomePhone
      trip={trip()}
      later={[]}
      state={{ ...state, trips: [trip(), ...state.trips.slice(1)] }}
      today={today}
      weather={WEATHER}
      map={null}
      busy={false}
      {...handlers()}
    />,
  );
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("the laptop Home during the trip", () => {
  it("says ON NOW with the dates, Day N of M instead of the countdown, and Open list", () => {
    laptop("2027-03-18", { phase: "none" });
    const chip = screen.getByText(/^ON NOW/);
    expect(chip.textContent).toContain("Sun 14 – Wed 24 Mar");
    expect(chip.hasAttribute("data-on-now")).toBe(true);
    expect(screen.queryByText(/NEXT TRIP/)).toBeNull();
    expect(screen.getByText(/^Day/).textContent).toBe("Day 5 of 11");
    expect(screen.queryByText(/days to go/)).toBeNull();
    expect(screen.getByRole("link", { name: /^Open list:/ })).toBeTruthy();
  });

  it("says Last day on the end date", () => {
    laptop("2027-03-24", { phase: "none" });
    expect(screen.getByText("Last day")).toBeTruthy();
    expect(screen.queryByText(/^Day /)).toBeNull();
  });

  it("keeps NEXT TRIP and the countdown before the trip, and on its start day", () => {
    const view = laptop("2027-03-10", { phase: "none" });
    expect(screen.getByText(/^NEXT TRIP/).hasAttribute("data-on-now")).toBe(false);
    expect(screen.getAllByText(/days to go/).length).toBeGreaterThan(0);
    view.unmount();
    laptop("2027-03-14", { phase: "none" });
    expect(screen.getByText(/^NEXT TRIP/)).toBeTruthy();
    expect(screen.queryByText(/^Day /)).toBeNull();
  });

  it("marks the stay the person is in, once, before the other stays", () => {
    laptop("2027-03-18", WEATHER);
    const rows = screen
      .getAllByRole("listitem")
      .filter((li) => li.hasAttribute("data-weather-source"));
    expect(rows.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Porto"),
      expect.stringContaining("Lisbon"),
    ]);
    expect(within(rows[0]).getByText("You're here")).toBeTruthy();
    expect(screen.getAllByText("You're here")).toHaveLength(1);
  });
});

describe("the phone Home during the trip", () => {
  it("says ON NOW with the dates and nights, and the day badge", () => {
    phone("2027-03-18");
    expect(screen.getByText(/^ON NOW/).textContent).toContain("14–24 Mar · 10 nights");
    expect(screen.getByText(/^Day/).textContent).toBe("Day 5 of 11");
    expect(screen.queryByText(/NEXT TRIP/)).toBeNull();
    expect(screen.getByRole("link", { name: /^Open list:/ })).toBeTruthy();
  });

  it("says Last day on the end date, and NEXT TRIP before it starts", () => {
    const view = phone("2027-03-24");
    expect(screen.getByText("Last day")).toBeTruthy();
    view.unmount();
    phone("2027-03-02");
    expect(screen.getByText(/^NEXT TRIP/)).toBeTruthy();
    expect(screen.queryByText("Last day")).toBeNull();
  });

  it("marks the current stay on the Weather pill's panel", async () => {
    phone("2027-03-18");
    await userEvent.click(screen.getByRole("tab", { name: /^Weather/ }));
    expect(screen.getAllByText("You're here")).toHaveLength(1);
  });
});

describe("a one-day trip on its day", () => {
  const oneDay = {
    ...trip(),
    end: "2027-03-14",
    stops: [stay("Lisbon", "2027-03-14", "2027-03-14")],
  };

  it("says Today on the laptop badge, and Leaves today for a longer trip", () => {
    const view = render(
      <HomeLaptop
        trip={oneDay}
        later={[]}
        today="2027-03-14"
        weather={{ phase: "none" }}
        map={null}
        busy={false}
        {...handlers()}
      />,
    );
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
    expect(screen.queryByText("Leaves today")).toBeNull();
    view.unmount();
    laptop("2027-03-14", { phase: "none" });
    expect(screen.getAllByText("Leaves today").length).toBeGreaterThan(0);
  });

  it("says Today on the phone badge", () => {
    const state = sampleLifecycleState();
    render(
      <HomePhone
        trip={oneDay}
        later={[]}
        state={{ ...state, trips: [oneDay, ...state.trips.slice(1)] }}
        today="2027-03-14"
        weather={{ phase: "none" }}
        map={null}
        busy={false}
        {...handlers()}
      />,
    );
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
  });
});

describe("the current stay without weather", () => {
  it("is first, marked, and says weather isn't available (laptop)", () => {
    const unavailable: CityWeather = {
      ...row("Lisbon", 0, true),
      range: "",
      summary: "Weather isn't available for Lisbon right now.",
      unavailable: true,
    };
    laptop("2027-03-15", { phase: "ready", city: [unavailable, row("Porto", 1, false)] });
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.hasAttribute("data-weather-source"));
    expect(items[0].textContent).toContain("You're here");
    expect(items[0].textContent).toContain("Lisbon");
    expect(items[0].textContent).toContain("Weather isn't available for Lisbon right now.");
    expect(items[0].textContent).not.toContain("·");
  });
});

describe("with #460's packed states (merged develop)", () => {
  const packedTrip = (extra: Partial<LifecycleTrip> = {}): LifecycleTrip => ({
    ...trip(),
    ready: false,
    items: trip().items.map((item) => ({ ...item, packed: item.qty })),
    toiletryBagPacked: true,
    ...extra,
  });

  it("keeps ON NOW and the Open list button on a fully packed or Ready trip while it is on (laptop)", () => {
    for (const extra of [{}, { ready: true }]) {
      const view = render(
        <HomeLaptop
          trip={packedTrip(extra)}
          later={[]}
          today="2027-03-18"
          weather={{ phase: "none" }}
          map={null}
          busy={false}
          {...handlers()}
        />,
      );
      expect(screen.getByText(/^ON NOW/)).toBeTruthy();
      expect(screen.queryByText(/^READY ·/)).toBeNull();
      expect(screen.getByRole("link", { name: /^Open list:/ })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
      view.unmount();
    }
  });

  it("keeps the READY chip before departure", () => {
    render(
      <HomeLaptop
        trip={packedTrip({ ready: true })}
        later={[]}
        today="2027-03-02"
        weather={{ phase: "none" }}
        map={null}
        busy={false}
        {...handlers()}
      />,
    );
    expect(screen.getByText(/^READY ·/)).toBeTruthy();
    expect(screen.queryByText(/^ON NOW/)).toBeNull();
  });

  it("keeps ON NOW and Open list on a packed or Ready trip while it is on (phone)", () => {
    for (const extra of [{}, { ready: true }]) {
      const state = sampleLifecycleState();
      const t = packedTrip(extra);
      const view = render(
        <HomePhone
          trip={t}
          later={[]}
          state={{ ...state, trips: [t, ...state.trips.slice(1)] }}
          today="2027-03-18"
          weather={{ phase: "none" }}
          map={null}
          busy={false}
          {...handlers()}
        />,
      );
      expect(screen.getByText(/^ON NOW/)).toBeTruthy();
      expect(screen.getByRole("link", { name: /^Open list:/ })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
      view.unmount();
    }
  });
});
