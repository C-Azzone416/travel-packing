// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripItem } from "@/domain/trip";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import { HomeLaptop, type HomeLaptopProps } from "./HomeLaptop";
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

function setup(props: Partial<HomeLaptopProps> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onRemove: vi.fn(),
    onOpenArchive: vi.fn(),
  };
  const view = render(
    <HomeLaptop
      trip={trip()}
      later={[]}
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

describe("HomeLaptop", () => {
  it("has the landmarks and headings in order, and names the map", () => {
    setup({ later: [{ ...trip(), id: "t2", start: "2027-04-02", stops: [stop("Denver")] }] });
    expect(screen.getByRole("heading", { level: 1, name: "Trips" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "In the bag · tap a cube",
      "Lisbon & Porto",
      "Upcoming trips",
    ]);
    expect(screen.getByRole("img", { name: "Route map: Chicago to Lisbon" })).toBeTruthy();
    expect(screen.getByRole("region", { name: /In the bag/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Lisbon/ })).toBeTruthy();
  });

  it("captions the map, shows the quantity count and a plain fallback without a map", () => {
    setup({ map: null });
    expect(
      screen.getByText(
        "ORD → LIS → OPO → ORD · flight · 10 nights · 2 cities"
          .replace("LIS", "Lisbon")
          .replace("OPO", "Porto"),
      ),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Route map unavailable" })).toBeTruthy();
    expect(screen.getByText("19")).toBeTruthy();
    expect(screen.getByText("of 29")).toBeTruthy();
  });

  it("makes every cube a link into Packing with a spoken count, and outlines the weather cube", () => {
    setup({ weather: { phase: "ready", cells: [], city: [city("Porto", true)] } });
    const clothing = screen.getByRole("link", { name: /Clothing/ });
    expect(clothing.getAttribute("href")).toBe("/trips/t1?cube=clothing");
    expect(within(clothing).getByText("9 of 14 packed")).toBeTruthy();
    const rain = screen.getByRole("link", { name: /Rain gear/ });
    expect(rain.getAttribute("data-cube-state")).toBe("alert");
    expect(within(rain).getByText("added for Porto rain")).toBeTruthy();
    expect(
      within(screen.getByRole("link", { name: /Documents/ })).getByText("passport ✓"),
    ).toBeTruthy();
  });

  it("starts or continues packing at the first open cube", () => {
    const { unmount } = setup();
    const go = screen.getByRole("link", { name: "Continue packing: Lisbon & Porto" });
    expect(go.getAttribute("href")).toBe("/trips/t1?cube=clothing");
    unmount();
    setup({ trip: trip({ items: [item("tops", "Clothing", 3, 0)] }) });
    expect(screen.getByRole("link", { name: /Start packing/ })).toBeTruthy();
  });

  it("sends a Ready trip to Review bag and a trip under way to Open list", () => {
    const { unmount } = setup({ trip: trip({ ready: true }) });
    expect(screen.getByRole("link", { name: /Review bag/ })).toBeTruthy();
    unmount();
    setup({ today: "2027-03-16" });
    expect(screen.getByRole("link", { name: /Open list/ })).toBeTruthy();
    expect(screen.queryByText(/days to go/)).toBeNull();
  });

  it("shows the tag: eyebrow with dates, name and subtitle, countdown and facts", () => {
    setup();
    expect(screen.getByText(/NEXT TRIP/).textContent).toBe("NEXT TRIP · Sun 14 – Wed 24 Mar");
    expect(screen.getByText("12 days to go", { selector: ".sr-only" })).toBeTruthy();
    expect(screen.getByText("flight · 10 nights · 2 cities")).toBeTruthy();
    expect(screen.getByText("& Porto", { selector: "p" })).toBeTruthy();
    expect(document.querySelector("[data-countdown='to-go']")?.textContent).toBe("12 days to go");
  });

  it("says Leaves today on the day", () => {
    setup({ today: "2027-03-14" });
    expect(document.querySelector("[data-countdown='to-go']")?.textContent).toBe("Leaves today");
  });

  it("lists the cities as disclosure buttons: the alert city opens itself, the other opens on tap", async () => {
    const user = userEvent.setup();
    setup({
      weather: { phase: "ready", cells: [], city: [city("Lisbon", false), city("Porto", true)] },
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Pack for · tap a place for daily" }),
    ).toBeTruthy();
    const lisbon = screen.getByRole("button", { name: /Lisbon · 70°\/54°/ });
    const porto = screen.getByRole("button", { name: /Porto · 63°\/48°/ });
    expect(lisbon.getAttribute("aria-expanded")).toBe("false");
    expect(porto.getAttribute("aria-expanded")).toBe("true");
    expect(porto.textContent).toContain("Rain · 4 added");
    expect(screen.getByRole("region", { name: "Porto forecast" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "+3 more days" }).getAttribute("href")).toBe(
      "/trips/t1",
    );
    await user.click(lisbon);
    expect(lisbon.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Lisbon forecast" })).toBeTruthy();
    await user.click(porto);
    expect(porto.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Porto forecast" })).toBeNull();
  });

  it("says 'Rain · 0 added' for an alert city with nothing added and nothing to review, and shows typical cities as plain rows", () => {
    const typical: CityWeather = {
      ...city("Lisbon", false),
      source: "typical",
      tiles: [],
      summary: "typical, mostly dry",
    };
    setup({
      trip: trip({ items: [item("tops", "Clothing", 3, 0)] }),
      weather: { phase: "ready", cells: [], city: [typical, city("Porto", true)] },
    });
    expect(screen.getByRole("button", { name: /^Porto/ }).textContent).toContain("Rain · 0 added");
    expect(screen.queryByRole("button", { name: /^Lisbon/ })).toBeNull();
    expect(screen.getByText(/typical, mostly dry/)).toBeTruthy();
  });

  it("shows the Usual weather block before the forecast opens, with no tiles", () => {
    setup({
      today: "2027-01-02",
      weather: {
        phase: "ready",
        cells: [],
        city: [city("Porto", true)],
        usual: [
          {
            id: "0",
            city: "Lisbon",
            dates: "14 – 24 Mar",
            line: "rarely rains",
            range: "64° / 51°",
          },
        ],
      },
    });
    expect(screen.getByTestId("usual-weather")).toBeTruthy();
    expect(screen.getByTestId("forecast-opens").textContent).toBe("Forecast opens Sat 27 Feb");
    expect(screen.queryByRole("button", { name: /^Porto/ })).toBeNull();
    expect(screen.queryByText("ALERT")).toBeNull();
  });

  it("still shows the Usual block, with 'isn't available', when far out and weather cannot load", () => {
    setup({ today: "2027-01-02", weather: { phase: "unavailable" } });
    expect(screen.getByText(/Weather isn.t available for Lisbon right now/)).toBeTruthy();
  });

  it("says weather is unavailable when it cannot load near the trip, and shows the off block", () => {
    const { unmount } = setup({ weather: { phase: "unavailable" } });
    expect(screen.getByText("Weather is unavailable right now.")).toBeTruthy();
    unmount();
    setup({ weather: { phase: "off" } });
    expect(screen.getByTestId("weather-off")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  it("lists upcoming trips as links with a date, name and route, and the page links", () => {
    setup({
      today: "2026-12-01",
      later: [
        {
          ...trip(),
          id: "t2",
          name: "Rockies long weekend",
          start: "2027-04-02",
          stops: [stop("Denver")],
        },
      ],
    });
    const row = screen.getByRole("link", { name: /Rockies long weekend/ });
    expect(row.getAttribute("href")).toBe("/trips/t2");
    expect(row.textContent).toContain("02 APR 2027");
    expect(row.textContent).toContain("ORD → Denver");
    expect(screen.getByRole("link", { name: "Past & archive" }).getAttribute("href")).toBe(
      "/stamps",
    );
    expect(screen.getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
  });

  it("keeps Plan a trip and hides the list when nothing comes after the next trip", () => {
    setup();
    expect(screen.getByRole("link", { name: "Plan a trip" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "" })).toBeNull();
  });

  it("keeps Edit trip, Copy, Archive and Remove in the trip menu", async () => {
    const user = userEvent.setup();
    const { onEdit, onArchive, onRemove, onOpenArchive } = setup();
    await user.click(screen.getByRole("button", { name: "More actions for Lisbon & Porto" }));
    expect(screen.getByRole("menuitem", { name: "Copy trip" }).getAttribute("href")).toBe(
      "/trips/new?copy=t1",
    );
    await user.click(screen.getByRole("menuitem", { name: "Past trips & archive" }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "More actions for Lisbon & Porto" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(onEdit).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: "More actions for Lisbon & Porto" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: "More actions for Lisbon & Porto" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("t1");
  });

  it("marks itself busy while a save is running", () => {
    const { container } = setup({ busy: true });
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
  });
});
