import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripItem } from "@/domain/trip";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import { sampleLifecycleState } from "./fixtures";
import {
  alertCities,
  alertHeading,
  bagTotals,
  countdownFor,
  cityWeather,
  cubeSummaries,
  firstOpenCube,
  heroName,
  isInternational,
  packingHref,
  suitcaseButtonLabel,
  tagDates,
  upcomingRow,
  usualRows,
  weatherNote,
} from "./home-view";

const place = (id: string, city: string, countryCode = ""): SampleLocation => ({
  id,
  city,
  region: "",
  country: "",
  countryCode,
  label: city,
});
const stop = (
  city: string,
  countryCode = "PT",
  arrive = "2027-03-14",
  leave = "2027-03-17",
): TripStop => ({
  location: place(city.toLowerCase(), city, countryCode),
  arrive,
  leave,
});
const item = (
  id: string,
  category: string,
  qty: number,
  packed: number,
  extra: Partial<TripItem> = {},
): TripItem => ({
  id,
  name: id,
  category,
  qty,
  packed,
  section: "main",
  ...extra,
});

function trip(overrides: Partial<LifecycleTrip> = {}): LifecycleTrip {
  return {
    ...sampleLifecycleState().trips[0],
    id: "t1",
    start: "2027-03-14",
    end: "2027-03-24",
    stops: [stop("Lisbon"), stop("Porto")],
    origin: { location: place("home", "Seattle", "US"), airportCode: "SEA" },
    travelMode: "fly",
    name: null,
    items: [
      item("tops", "Clothing", 6, 4),
      item("socks", "Clothing", 8, 5),
      item("toothbrush", "Bathroom", 1, 1, { groupId: "toiletries" }),
      item("charger", "Tech", 2, 2),
      item("passport", "Other essentials", 1, 0),
      item("guide", "Accessories", 3, 0),
    ],
    ...overrides,
  } as LifecycleTrip;
}

describe("cubeSummaries", () => {
  it("counts quantity per cube and sums them, in the Home order", () => {
    const cubes = cubeSummaries(trip());
    expect(cubes.map((c) => [c.name, c.packed, c.total])).toEqual([
      ["Clothing", 9, 14],
      ["Toiletries", 1, 1],
      ["Tech", 2, 2],
      ["Documents", 0, 1],
      ["Misc", 0, 3],
    ]);
    expect(bagTotals(cubes)).toEqual({ packed: 12, total: 21 });
  });

  it("caps a cube's packed count at its quantity and leaves empty cubes out", () => {
    const cubes = cubeSummaries(trip({ items: [item("tops", "Clothing", 2, 9)] }));
    expect(cubes).toHaveLength(1);
    expect(cubes[0]).toMatchObject({ packed: 2, total: 2, complete: true });
  });

  it("writes the 3.4 oz note only when flying", () => {
    const toiletries = (t: LifecycleTrip) => cubeSummaries(t).find((c) => c.cube === "toiletries")!;
    expect(toiletries(trip()).note).toBe("under 3.4 oz");
    expect(toiletries(trip({ travelMode: "drive" })).note).toBeNull();
    expect(toiletries(trip({ travelMode: null })).note).toBeNull();
  });

  it("flags Morning of on Toiletries by default", () => {
    const cubes = cubeSummaries(trip());
    expect(cubes.find((c) => c.cube === "toiletries")!.morningOf).toBe(true);
    expect(cubes.find((c) => c.cube === "clothing")!.morningOf).toBe(false);
  });

  it("notes the passport on an international trip: unpacked, packed, and missing", () => {
    const docs = (t: LifecycleTrip) => cubeSummaries(t).find((c) => c.cube === "documents")!;
    expect(docs(trip()).note).toBe("passport");
    expect(docs(trip({ items: [item("passport", "Other essentials", 1, 1)] })).note).toBe(
      "passport ✓",
    );
    expect(docs(trip({ items: [item("visa", "Other essentials", 1, 0)] })).note).toBe(
      "add passport",
    );
    expect(docs(trip({ stops: [stop("Denver", "US")] })).note).toBeNull();
    expect(docs(trip({ origin: null })).note).toBeNull();
  });

  it("outlines the weather cube while one of its items is unpacked, and names it for the condition", () => {
    const items = [
      item("tops", "Clothing", 1, 1),
      item("weather-umbrella", "Weather suggestion", 1, 1),
      item("weather-rain-jacket", "Weather suggestion", 1, 0),
    ];
    const [, weather] = cubeSummaries(trip({ items }), { cities: ["Porto"] });
    expect(weather).toMatchObject({
      cube: "weather",
      name: "Rain gear",
      packed: 1,
      total: 2,
      alert: true,
      note: "added for Porto rain",
    });
    const done = cubeSummaries(trip({ items: items.map((i) => ({ ...i, packed: i.qty })) }), {
      cities: ["Porto"],
    });
    expect(done[1].alert).toBe(false);
    expect(done[1].complete).toBe(true);
  });

  it("shows only the first two notes, joined", () => {
    const items = [item("weather-umbrella", "Weather suggestion", 1, 0)];
    const [weather] = cubeSummaries(trip({ items }), { cities: ["Lisbon", "Porto"] });
    expect(weather.note).toBe("added for Lisbon & Porto rain");
  });
});

describe("weatherNote", () => {
  it("covers one, two, three cities, other conditions and none", () => {
    expect(weatherNote("Rain gear", ["Porto"])).toBe("added for Porto rain");
    expect(weatherNote("Snow gear", ["A", "B"])).toBe("added for A & B snow");
    expect(weatherNote("Sun gear", ["A", "B", "C"])).toBe("added for 3 cities");
    expect(weatherNote("Weather gear", ["A"])).toBe("added for A");
    expect(weatherNote("Rain gear", [])).toBe("added for rain");
    expect(weatherNote("Weather gear", [])).toBe("added for the weather");
    expect(weatherNote("Rain gear", ["A", "B", "C", "D"])).toBe("added for 4 cities");
  });
});

describe("isInternational", () => {
  const base = { start: "a", end: "b", location: null };
  it("compares the stops' countries with the home country, and never guesses", () => {
    const home = { location: place("h", "Seattle", "us") };
    expect(isInternational({ ...base, origin: home, stops: [stop("Lisbon", "PT")] })).toBe(true);
    expect(isInternational({ ...base, origin: home, stops: [stop("Denver", "US")] })).toBe(false);
    expect(isInternational({ ...base, origin: null, stops: [stop("Lisbon", "PT")] })).toBeNull();
    expect(isInternational({ ...base, origin: home, stops: [stop("Lisbon", "")] })).toBeNull();
    expect(isInternational({ ...base, origin: home, stops: [] })).toBeNull();
  });
});

describe("suitcase button and links", () => {
  it("is Start, Continue or Open list by phase, and Review bag when Ready", () => {
    expect(suitcaseButtonLabel({ packed: 0, total: 9 }, false, "soon")).toBe("Start packing");
    expect(suitcaseButtonLabel({ packed: 3, total: 9 }, false, "soon")).toBe("Continue packing");
    expect(suitcaseButtonLabel({ packed: 3, total: 9 }, false, "during")).toBe("Open list");
    expect(suitcaseButtonLabel({ packed: 9, total: 9 }, true, "soon")).toBe("Review bag");
  });

  it("opens Packing at a cube, or at the first cube that is not complete", () => {
    expect(packingHref("t1")).toBe("/trips/t1");
    expect(packingHref("t1", "tech")).toBe("/trips/t1?cube=tech");
    expect(firstOpenCube(cubeSummaries(trip()))).toBe("clothing");
    expect(
      firstOpenCube(cubeSummaries(trip({ items: [item("tops", "Clothing", 1, 1)] }))),
    ).toBeNull();
    expect(firstOpenCube([])).toBeNull();
  });
});

describe("tag text", () => {
  it("writes the dates with the month said once, and the year when it is another year", () => {
    expect(tagDates({ start: "2026-03-14", end: "2026-03-24" }, "2026-03-02")).toBe(
      "Sat 14 – Tue 24 Mar",
    );
    expect(tagDates({ start: "2026-02-28", end: "2026-03-10" }, "2026-02-01")).toBe(
      "Sat 28 Feb – Tue 10 Mar",
    );
    expect(tagDates({ start: "2027-03-14", end: "2027-03-24" }, "2026-11-05")).toBe(
      "Sun 14 – Wed 24 Mar 2027",
    );
    expect(tagDates({ start: "2026-03-14", end: "2026-03-14" }, "2026-03-01")).toBe("Sat 14 Mar");
    expect(tagDates({ start: "", end: "" }, "2026-03-01")).toBe("Choose dates");
  });

  it("splits an unnamed multi-stop trip into a title and '& Porto', and keeps a named trip whole", () => {
    expect(heroName(trip())).toEqual({ title: "Lisbon", subtitle: "& Porto", size: "xl" });
    expect(
      heroName(trip({ stops: [stop("Lisbon"), stop("Porto"), stop("Madrid"), stop("lisbon")] })),
    ).toMatchObject({
      title: "Lisbon",
      subtitle: "& Porto, Madrid",
    });
    expect(heroName(trip({ name: "Rockies long weekend" }))).toEqual({
      title: "Rockies long weekend",
      subtitle: null,
      size: "m",
    });
    expect(heroName(trip({ stops: [stop("San Francisco")] }))).toMatchObject({
      title: "San Francisco",
      size: "l",
    });
  });

  it("counts down in whole days, says Leaves today, and has no badge once started", () => {
    expect(countdownFor({ start: "2027-03-14" }, "2027-03-02")).toEqual({
      days: 12,
      spoken: "12 days to go",
    });
    expect(countdownFor({ start: "2027-03-14" }, "2027-03-13")).toEqual({
      days: 1,
      spoken: "1 day to go",
    });
    expect(countdownFor({ start: "2027-03-14" }, "2027-03-14")).toEqual({
      days: 0,
      spoken: "Leaves today",
    });
    expect(countdownFor({ start: "2027-03-14" }, "2027-03-15")).toBeNull();
  });

  it("makes an upcoming row: DD MMM in capitals, the name and the short route", () => {
    const row = upcomingRow(
      trip({ start: "2026-04-02", stops: [stop("Denver", "US")] }),
      "2026-03-01",
    );
    expect(row).toEqual({ id: "t1", date: "02 APR", name: "Denver", route: "SEA → Denver" });
    expect(upcomingRow(trip({ start: "2027-04-02" }), "2026-03-01").date).toBe("02 APR 2027");
    expect(upcomingRow(trip({ start: "" }), "2026-03-01").date).toBe("");
  });
});

describe("cityWeather", () => {
  const day = (date: string, rain: number, extra: Partial<StopWeather["days"][number]> = {}) => ({
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
    ...extra,
  });
  const stops = [stop("Lisbon"), stop("Porto")];
  const weather: StopWeather[] = [
    { stopIndex: 0, status: "ok", days: [day("2027-03-14", 0.1), day("2027-03-15", 0.2)] },
    {
      stopIndex: 1,
      status: "ok",
      days: [
        { ...day("2027-03-16", 0.8), stopIndex: 1 },
        { ...day("2027-03-17", 0.39), stopIndex: 1 },
        { ...day("2027-03-18", 0.4), stopIndex: 1 },
      ],
    },
  ];

  it("summarises each stay, outlines the rainy one and builds its day tiles", () => {
    const rows = cityWeather(stops, weather, "F", "2027-03-10");
    expect(rows.map((r) => [r.city, r.range, r.summary, r.alert])).toEqual([
      ["Lisbon", "59°/50°", "mostly dry", false],
      ["Porto", "59°/50°", "rain Tue–Thu", true],
    ]);
    expect(rows[1].condition).toBe("rain");
    expect(rows[1].tiles.map((t) => [t.day, t.dayOfMonth, t.rain, t.precipProbability])).toEqual([
      ["Tue", "16", true, 0.8],
      ["Wed", "17", false, 0.39],
      ["Thu", "18", true, 0.4],
    ]);
    expect(alertCities(rows)).toEqual(["Porto"]);
  });

  it("says one rainy day by its weekday, snow, and typical-only stays as typical", () => {
    const one = cityWeather(
      [stops[0]],
      [{ stopIndex: 0, status: "ok", days: [day("2027-03-14", 0.9), day("2027-03-15", 0.1)] }],
      "C",
      "2027-03-10",
    );
    expect(one[0]).toMatchObject({ summary: "rain Sun", range: "15°/10°" });
    const snow = cityWeather(
      [stops[0]],
      [{ stopIndex: 0, status: "ok", days: [day("2027-03-14", 0.2, { snowCm: 3 })] }],
      "C",
      "2027-03-10",
    );
    expect(snow[0]).toMatchObject({ summary: "snow likely", condition: "snow", alert: true });
    const typical = cityWeather(
      [stops[0]],
      [
        {
          stopIndex: 0,
          status: "ok",
          days: [
            day("2027-03-14", 0.5, { source: "typical" }),
            day("2027-03-15", 0.1, { source: "typical" }),
          ],
        },
      ],
      "C",
      "2027-01-01",
    );
    expect(typical[0]).toMatchObject({ source: "typical", alert: false, tiles: [] });
    expect(typical[0].summary).toBe("typical, rain on 1 of 2 days");
    const dryTypical = cityWeather(
      [stops[0]],
      [{ stopIndex: 0, status: "ok", days: [day("2027-03-14", 0.1, { source: "typical" })] }],
      "C",
      "2027-01-01",
    );
    expect(dryTypical[0].summary).toBe("typical, mostly dry");
  });

  it("caps the tiles at seven and counts the rest; leaves out a stay with no weather", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      day(`2027-03-${String(10 + i).padStart(2, "0")}`, 0.1),
    );
    const rows = cityWeather(
      stops,
      [
        { stopIndex: 0, status: "ok", days: many },
        { stopIndex: 1, status: "unavailable", days: [] },
      ],
      "F",
      "2027-03-01",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(7);
    expect(rows[0].more).toBe(2);
  });

  it("names the alert for the cube or the condition", () => {
    expect(alertHeading("Rain gear", null)).toBe("Rain");
    expect(alertHeading("Weather gear", "snow")).toBe("Snow");
    expect(alertHeading(null, "rain")).toBe("Rain");
    expect(alertHeading(null, null)).toBe("Weather");
  });
});

describe("usualRows", () => {
  const stops = [stop("Lisbon"), stop("Porto")];
  const days = [
    {
      date: "2027-03-14",
      stopIndex: 0,
      source: "typical" as const,
      highC: 18,
      lowC: 10,
      precipProbability: 0.5,
      precipMm: 1,
      snowCm: 0,
      uvIndexMax: null,
      sunshineHours: null,
    },
  ];
  it("gives each stop its averages, 'unavailable' when the provider has none, and no flag when weather was never asked", () => {
    const rows = usualRows(stops, [{ stopIndex: 0, status: "ok", days }], "F", "2027-01-01");
    expect(rows[0]).toMatchObject({
      city: "Lisbon",
      range: "64° / 50°",
      line: "about 1 rainy day",
    });
    expect(rows[1].unavailable).toBe(true);
    expect(usualRows(stops, null, "F", "2027-01-01")[0].unavailable).toBe(false);
    const dry = usualRows(
      [stops[0]],
      [{ stopIndex: 0, status: "ok", days: [{ ...days[0], precipProbability: 0.1 }] }],
      "C",
      "2027-01-01",
    );
    expect(dry[0].line).toBe("rarely rains");
  });
});
