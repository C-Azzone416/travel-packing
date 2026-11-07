// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripItem } from "@/domain/trip";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import { HomePhone, type HomePhoneProps } from "./HomePhone";
import type { CityWeather } from "./home-view";
import type { StopWeather } from "@/domain/weather/types";

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

afterEach(() => window.history.replaceState(null, "", "/"));

/** A rainy forecast for one stop: what the Weather pill's ALERT is about, once it is not on the list yet. */
const rainyStop = (stopIndex: number): StopWeather =>
  ({
    stopIndex,
    status: "ok",
    days: ["2027-03-15", "2027-03-16"].map((date) => ({
      date,
      stopIndex,
      source: "forecast",
      highC: 15,
      lowC: 10,
      precipProbability: 0.9,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: 3,
      sunshineHours: 5,
    })),
  }) as StopWeather;
/** A dry, hot, high-UV forecast: it suggests sun items, but has no rain or snow. */
const dryHotStop = (stopIndex: number): StopWeather =>
  ({
    ...rainyStop(stopIndex),
    days: rainyStop(stopIndex).days.map((day) => ({
      ...day,
      highC: 34,
      lowC: 22,
      precipProbability: 0,
      uvIndexMax: 10,
      sunshineHours: 12,
    })),
  }) as StopWeather;
const bareTrip = () => trip({ items: [item("tops", "Clothing", 3, 0)] });

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

  it("shows ALERT while a city has suggestions to review, announces it, and opens the rainy city", async () => {
    const user = userEvent.setup();
    setup({
      trip: bareTrip(),
      weather: {
        phase: "ready",
        city: [city("Lisbon", false), city("Porto", true)],
        review: { stops: [rainyStop(1)], suppressed: {} },
      },
    });
    const pill = screen.getByRole("tab", { name: "Weather ALERT" });
    expect(pill.textContent).toBe("Weather ALERT");
    expect(screen.getByText(/Weather alert: suggestions to review for Porto\./)).toBeTruthy();
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
    expect(within(panel).getByText(/\d+ to review/)).toBeTruthy();
  });

  it("counts the changes to review on a dry, high-UV city too, and opens that city", async () => {
    const user = userEvent.setup();
    setup({
      trip: bareTrip(),
      weather: {
        phase: "ready",
        city: [city("Lisbon", false)],
        review: { stops: [dryHotStop(0)], suppressed: {} },
      },
    });
    // The pill and the city row agree: there are changes to review, though nothing is rainy.
    await user.click(screen.getByRole("tab", { name: "Weather ALERT" }));
    const panel = screen.getByRole("tabpanel");
    const row = within(panel).getByRole("button", { name: /Lisbon/ });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toMatch(/\d+ to review/);
  });

  it("never alerts before the forecast opens, and says N/A when the usual row has no observations", () => {
    const far = setup({
      today: FAR_TODAY,
      trip: bareTrip(),
      weather: {
        phase: "ready",
        usual: [{ city: "Lisbon", unavailable: false }] as never,
        review: { stops: [dryHotStop(0), rainyStop(1)], suppressed: {} },
      },
    });
    expect(screen.getByRole("tab", { name: "Weather Usual" })).toBeTruthy();
    expect(screen.queryByText(/Weather alert/)).toBeNull();
    far.unmount();
    setup({
      today: FAR_TODAY,
      weather: { phase: "ready", usual: [{ city: "Lisbon", unavailable: true }] as never },
    });
    expect(screen.getByRole("tab", { name: "Weather N/A" })).toBeTruthy();
  });

  it("does not alert for rain that is already on the list, and clears once the last suggestion is resolved", () => {
    const rain = { phase: "ready" as const, city: [city("Lisbon", false), city("Porto", true)] };
    // The default trip holds its rain gear: the forecast has rain, nothing is left to review.
    const done = setup({ weather: rain });
    expect(screen.getByRole("tab", { name: "Weather Clear" })).toBeTruthy();
    expect(screen.queryByText(/Weather alert/)).toBeNull();
    done.unmount();
    const view = setup({
      trip: bareTrip(),
      weather: { ...rain, review: { stops: [rainyStop(1)], suppressed: {} } },
    });
    expect(screen.getByRole("tab", { name: "Weather ALERT" })).toBeTruthy();
    // Nothing is left to review (the suggestions were added or skipped): the same trip, with the rain on its list.
    view.rerender(
      <HomePhone
        trip={trip()}
        later={[]}
        state={sampleLifecycleState()}
        today="2027-03-02"
        weather={rain}
        map={null}
        busy={false}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onRemove={vi.fn()}
        onOpenArchive={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "Weather Clear" })).toBeTruthy();
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
    const usual = [
      { city: "Lisbon", dates: "Mar 14 – Mar 24", summary: "High 63°", range: "63° / 48°" },
    ];
    const view = setup({
      today: FAR_TODAY,
      weather: { phase: "ready", usual: usual as never },
    });
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
    expect(past.getAttribute("href")).toBe("/?tab=stamps");
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

  it("keeps the chosen pill in the address, opens the pill the address names, and follows Back", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?tab=future");
    const view = setup();
    expect(screen.getByRole("tab", { name: /^Future/ }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: /^Weather/ }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("weather");
    act(() => {
      window.history.replaceState(null, "", "/?tab=stamps");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: /^Stamps/ }).getAttribute("aria-selected")).toBe("true");
    view.unmount();
    window.history.replaceState(null, "", "/?tab=nonsense");
    setup();
    expect(screen.getByRole("tab", { name: /^Pack/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens Home's own Stamps panel from the Future footer, and leaves a modified click alone", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: /^Future/ }));
    await user.click(screen.getByRole("link", { name: /Past trips are with your stamps/ }));
    expect(screen.getByRole("tab", { name: /^Stamps/ }).getAttribute("aria-selected")).toBe("true");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("stamps");
  });

  it("draws the Pack map card without a visible route caption, keeping the route in its name", () => {
    setup();
    const figure = screen.getByRole("figure");
    expect(figure.getAttribute("aria-label")).toMatch(/Lisbon/);
    expect(figure.querySelector("figcaption")).toBeNull();
  });

  it("keeps one city open at a time on the Weather panel", async () => {
    const user = userEvent.setup();
    setup({
      weather: {
        phase: "ready",
        city: [{ ...city("Lisbon", true), stopIndex: 0 }, city("Porto", true)],
      },
    });
    await user.click(screen.getByRole("tab", { name: /^Weather/ }));
    const panel = screen.getByRole("tabpanel");
    const lisbon = within(panel).getByRole("button", { name: /Lisbon/ });
    const porto = within(panel).getByRole("button", { name: /Porto/ });
    expect(lisbon.getAttribute("aria-expanded")).toBe("true");
    expect(porto.getAttribute("aria-expanded")).toBe("false");
    await user.click(porto);
    expect(porto.getAttribute("aria-expanded")).toBe("true");
    expect(lisbon.getAttribute("aria-expanded")).toBe("false");
    await user.click(porto);
    expect(porto.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives each Future row the tag's menu: Edit, Copy, Archive and Remove", async () => {
    const user = userEvent.setup();
    const handlers = setup({
      later: [later("t2", "Denver", "2027-04-02"), later("t3", "Boston", "2027-05-10")],
    });
    await user.click(screen.getByRole("tab", { name: /^Future/ }));
    await user.click(screen.getByRole("button", { name: "More actions for Boston" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit trip",
      "Copy trip",
      "Archive",
      "Remove",
    ]);
    expect(screen.getByRole("menuitem", { name: "Copy trip" }).getAttribute("href")).toBe(
      "/trips/new?copy=t3",
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(handlers.onArchive).toHaveBeenCalledWith("t3");
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(handlers.onRemove).toHaveBeenCalledWith("t2");
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(handlers.onEdit).toHaveBeenCalledWith("t2");
  });
});
