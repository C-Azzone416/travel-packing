// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripItem } from "@/domain/trip";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import { HomePhone, type HomePhoneProps } from "./HomePhone";
import type { CityWeather } from "./home-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

const place = (city: string, countryCode: string): SampleLocation => ({
  id: city.toLowerCase(),
  city,
  region: "",
  country: "",
  countryCode,
  label: city,
});
const stop = (city: string): TripStop => ({
  location: place(city, "PT"),
  arrive: "2027-03-14",
  leave: "2027-03-24",
});
const item = (id: string, category: string, qty: number, packed: number): TripItem => ({
  id,
  name: id,
  category,
  qty,
  packed,
  section: "main",
});

function trip(extra: Partial<LifecycleTrip> = {}): LifecycleTrip {
  return {
    ...sampleLifecycleState().trips[0],
    id: "t1",
    start: "2027-03-14",
    end: "2027-03-24",
    stops: [stop("Lisbon"), stop("Porto")],
    origin: { location: place("Chicago", "US"), airportCode: "ORD" },
    travelMode: "fly",
    name: null,
    ready: false,
    items: [
      item("tops", "Clothing", 14, 9),
      item("charger", "Tech", 10, 8),
      item("passport", "Other essentials", 1, 1),
      item("weather-rain-jacket", "Weather suggestion", 4, 1),
    ],
    ...extra,
  } as LifecycleTrip;
}

const tile = (n: number, rain: boolean) => ({
  date: `2027-03-${10 + n}`,
  day: "Thu",
  dayOfMonth: String(10 + n),
  high: 59,
  low: 50,
  precipProbability: rain ? 0.8 : 0.1,
  rain,
});
const city = (name: string, alert: boolean): CityWeather => ({
  stopIndex: alert ? 1 : 0,
  city: name,
  range: alert ? "63°/48°" : "70°/54°",
  summary: alert ? "rain Thu–Sat" : "mostly dry",
  source: "forecast",
  alert,
  condition: alert ? "rain" : null,
  tiles: [tile(1, alert), tile(2, alert)],
  more: alert ? 3 : 0,
});

const FAR_TODAY = "2026-11-02";

function setup(props: Partial<HomePhoneProps> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onRemove: vi.fn(),
    onOpenArchive: vi.fn(),
  };
  const state = sampleLifecycleState();
  const view = render(
    <HomePhone
      trip={trip()}
      later={[]}
      state={{ ...state, trips: [trip(), ...state.trips.slice(1)] }}
      today="2027-03-02"
      weather={{ phase: "none" }}
      map={<svg role="img" aria-label="Route map: Chicago to Lisbon" />}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

const later = (id: string, name: string, start: string) =>
  trip({ id, name, start, end: start, stops: [stop(name)] });

describe("HomePhone", () => {
  it("draws the tag with its dates, nights and countdown, and the four pills", () => {
    setup();
    const tag = screen.getByRole("region", { name: /Lisbon/ });
    expect(within(tag).getByText(/NEXT TRIP · 14–24 Mar · 10 nights/)).toBeTruthy();
    expect(within(tag).getByText("12 days to go")).toBeTruthy();
    expect(within(tag).getAllByText("& Porto").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
        .slice(0, 3),
    ).toEqual(["Pack 19/29", "Weather N/A", "Future 0 trips"]);
    expect(screen.getByRole("tablist", { name: "Trip sections" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Trips" })).toBeTruthy();
  });

  it("says Leaves today / no badge once the trip has started", () => {
    const started = setup({ today: "2027-03-16" });
    expect(screen.queryByText(/days to go/)).toBeNull();
    started.unmount();
    setup({ today: "2027-03-14" });
    expect(screen.getByText("Leaves today")).toBeTruthy();
  });

  it("opens on Pack: the map, the quantity count, linked cubes and the one primary action", () => {
    setup({ weather: { phase: "ready", city: [city("Porto", true)] } });
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("home-tab-pack");
    expect(within(panel).getByRole("img", { name: "Route map: Chicago to Lisbon" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: /in the bag/ }).textContent).toBe(
      "19 / 29 in the bag",
    );
    expect(within(panel).getByText("tap a cube")).toBeTruthy();
    const clothing = within(panel).getByRole("link", { name: /Clothing/ });
    expect(clothing.getAttribute("href")).toBe("/trips/t1?cube=clothing");
    const rain = within(panel).getByRole("link", { name: /Rain gear/ });
    expect(rain.getAttribute("href")).toBe("/trips/t1?cube=weather");
    expect(
      within(panel)
        .getByRole("link", { name: "Continue packing: Lisbon & Porto" })
        .getAttribute("href"),
    ).toBe("/trips/t1?cube=clothing");
  });

  it("falls back to a plain Map unavailable block without a map", () => {
    setup({ map: null });
    expect(screen.getByRole("img", { name: "Route map unavailable" })).toBeTruthy();
  });

  it("shows ALERT on the Weather pill, announces it, and opens the rainy city's daily tiles", async () => {
    const user = userEvent.setup();
    setup({ weather: { phase: "ready", city: [city("Lisbon", false), city("Porto", true)] } });
    const pill = screen.getByRole("tab", { name: "Weather ALERT" });
    expect(pill.textContent).toBe("Weather ALERT");
    expect(screen.getByText("Weather alert: Porto.")).toBeTruthy();
    await user.click(pill);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("home-tab-weather");
    expect(within(panel).getByRole("button", { name: /Porto/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      within(panel)
        .getByRole("button", { name: /Lisbon/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(within(panel).getByText(/Rain · 4 added/)).toBeTruthy();
  });

  it("says Clear when no city has rain, and keeps every panel non-empty while weather loads or is missing", async () => {
    const user = userEvent.setup();
    const view = setup({ weather: { phase: "ready", city: [city("Lisbon", false)] } });
    expect(screen.getByRole("tab", { name: "Weather Clear" })).toBeTruthy();
    view.unmount();
    setup({ weather: { phase: "loading" } });
    await user.click(screen.getByRole("tab", { name: /^Weather/ }));
    expect(screen.getByText("Checking the weather…")).toBeTruthy();
  });

  it("says no weather when there is no weather source, and says so for a trip with no rows", async () => {
    const user = userEvent.setup();
    const view = setup({ weather: { phase: "none" } });
    await user.click(screen.getByRole("tab", { name: /^Weather/ }));
    expect(screen.getByText("No weather for this trip.")).toBeTruthy();
    view.unmount();
    setup({ weather: { phase: "ready", city: [] } });
    await user.click(screen.getByRole("tab", { name: /^Weather/ }));
    expect(screen.getByText("No weather to show for this trip yet.")).toBeTruthy();
  });

  it("shows Usual weather for a far trip and the off block when weather is off", async () => {
    const user = userEvent.setup();
    const view = setup({ today: FAR_TODAY, weather: { phase: "ready", usual: [] } });
    expect(screen.getByRole("tab", { name: "Weather Usual" })).toBeTruthy();
    view.unmount();
    setup({ weather: { phase: "off" } });
    await user.click(screen.getByRole("tab", { name: "Weather Off" }));
    expect(screen.getByTestId("weather-off")).toBeTruthy();
  });

  it("lists Future trips with a Plan a trip link and ends with the way to the stamps", async () => {
    const user = userEvent.setup();
    setup({ later: [later("t2", "Denver", "2027-04-02"), later("t3", "Boston", "2027-05-10")] });
    await user.click(screen.getByRole("tab", { name: "Future 2 trips" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Future trips" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    const rows = within(within(panel).getByRole("list", { name: "Future trips" })).getAllByRole(
      "link",
    );
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/trips/t2", "/trips/t3"]);
    expect(rows[0].textContent).toContain("02 APR");
    const past = within(panel).getByRole("link", { name: "Past trips are with your stamps ›" });
    expect(past.getAttribute("href")).toBe("/stamps");
  });

  it("says nothing else is planned, and still links to the stamps, with one trip singular", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Future 0 trips" }));
    expect(screen.getByText("No other trips planned yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Past trips are with your stamps/ })).toBeTruthy();
  });

  it("counts a single future trip as 1 trip", () => {
    setup({ later: [later("t2", "Denver", "2027-04-02")] });
    expect(screen.getByRole("tab", { name: "Future 1 trip" })).toBeTruthy();
  });

  it("shows the stamps (stickers and past trips) in the Stamps panel, without a second page heading", async () => {
    const user = userEvent.setup();
    setup({ today: "2026-11-02" });
    await user.click(screen.getByRole("tab", { name: /^Stamps/ }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("group", { name: "Filter stamps" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Past trips" })).toBeTruthy();
    expect(within(panel).queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("is a proper tab list: roving tabindex, arrow keys, Home and End move and select", async () => {
    const user = userEvent.setup();
    setup();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("home-tab-weather");
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tabs[3]);
    await user.keyboard("{Home}");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowLeft}");
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");
  });

  it("offers the trip menu: Edit, Copy, Archive, the archive list and Remove", async () => {
    const user = userEvent.setup();
    const handlers = setup();
    await user.click(screen.getByRole("button", { name: /More actions for/ }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit trip",
      "Copy trip",
      "Archive",
      "Past trips & archive",
      "Remove",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(handlers.onEdit).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: /More actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(handlers.onArchive).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: /More actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Past trips & archive" }));
    expect(handlers.onOpenArchive).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /More actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(handlers.onRemove).toHaveBeenCalledWith("t1");
  });

  it("is busy while a save is in flight", () => {
    const view = setup({ busy: true });
    expect(view.container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("names a single-city trip by its city, with no second line", () => {
    setup({ trip: trip({ stops: [stop("Lisbon")] }) });
    expect(screen.getByRole("heading", { level: 2, name: "Lisbon" })).toBeTruthy();
    expect(screen.queryByText("& Porto")).toBeNull();
  });
});
