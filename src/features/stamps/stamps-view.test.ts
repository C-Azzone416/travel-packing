import { describe, expect, it } from "vitest";
import { buildTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { SampleLocation } from "@/domain/trip-stops";
import {
  filterLabel,
  placeHash,
  stampTripView,
  stickerLook,
  stampsView,
  tripMatchesFilter,
} from "./stamps-view";

const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

function place(city: string, countryCode: string, region = "Region"): SampleLocation {
  return {
    id: `${countryCode}-${city}`,
    city,
    region,
    country: countryCode === "US" ? "United States" : "Portugal",
    countryCode,
    label: `${city}, ${region}`,
  };
}

let id = 0;
function trip(
  city: string,
  countryCode: string,
  start: string,
  end: string,
  options: { region?: string; packed?: boolean; name?: string; airportCode?: string } = {},
): LifecycleTrip {
  const location = place(city, countryCode, options.region);
  const built = buildTrip(city, location, start, end, CONFIG, [], {
    newId: () => `trip-${++id}`,
    today: "2026-10-16",
  });
  built.stops[0] = {
    ...built.stops[0],
    ...(options.airportCode ? { airportCode: options.airportCode } : {}),
  };
  built.name = options.name;
  if (options.packed) built.items = built.items.map((item) => ({ ...item, packed: item.qty }));
  return built;
}

describe("the deterministic sticker rule", () => {
  it.each([
    ["us", "portland", 273566477, "squared", "accent", 0],
    ["ca", "vancouver", 2539078930, "rounded", "info", 3],
    ["pt", "lisbon", 1768105252, "rounded", "good", 3],
    ["pt", "porto", 3366726525, "circle", "accent", 3],
    ["us", "boston", 4122547034, "squared", "goldDeep", 4],
    ["jp", "tokyo", 3517094533, "rounded", "goldDeep", 2],
  ] as const)("matches %s|%s", (country, city, hash, shape, colour, tilt) => {
    expect(placeHash(`${country}|${city}`)).toBe(hash);
    expect(stickerLook(country, city)).toMatchObject({ hash, shape, colour, tilt });
  });
});

describe("Stamps view", () => {
  const today = "2026-10-16";

  it("groups repeat places, keeps upcoming places dashed, and counts completed trips", () => {
    const first = trip("Portland", "US", "2026-04-01", "2026-04-03", {
      region: "Oregon",
      airportCode: "PDX",
    });
    const repeat = trip("Portland", "US", "2026-07-01", "2026-07-04", {
      region: "Oregon",
      airportCode: "PDX",
      name: "Portland again",
    });
    const future = trip("Lisbon", "PT", "2027-03-01", "2027-03-05", {
      airportCode: "LIS",
    });
    const view = stampsView([future, first, repeat], today, "rolling");

    expect(view.stickers).toHaveLength(2);
    expect(view.stickers.find((entry) => entry.code === "PDX")).toMatchObject({
      completedCount: 2,
      upcoming: false,
      tripId: repeat.id,
    });
    expect(view.stickers.find((entry) => entry.code === "LIS")).toMatchObject({
      completedCount: 0,
      upcoming: true,
      tripId: future.id,
    });
    expect(view.pastTrips.map((entry) => entry.name)).toEqual(["Portland again", "Portland"]);
    expect(view.pastTrips).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PDX", stickerColour: "accent" })]),
    );
    expect(view.totals).toEqual({ trips: 2, places: 1, countries: 1, nights: 5 });
    expect(view.inked).toBe(1);
  });

  it("makes a sticker for every distinct stop and counts countries and nights once per trip", () => {
    const route = trip("Lisbon", "PT", "2026-09-01", "2026-09-08", { airportCode: "LIS" });
    route.destination = "Lisbon & Porto";
    route.stops.push({
      location: place("Porto", "PT", "Porto"),
      arrive: "2026-09-05",
      leave: "2026-09-08",
      airportCode: "OPO",
    });
    const view = stampsView([route], today, "rolling");
    expect(view.stickers.map((entry) => entry.code).sort()).toEqual(["LIS", "OPO"]);
    expect(view.totals).toEqual({ trips: 1, places: 2, countries: 1, nights: 7 });
  });

  it("uses the custom stamp label without changing a place's shape or colour", () => {
    const portland = trip("Portland", "US", "2026-07-01", "2026-07-03", {
      airportCode: "PDX",
    });
    const automatic = stampsView([portland], today, "rolling").stickers[0];
    portland.stampLabels = ["P22", null];
    const custom = stampsView([portland], today, "rolling").stickers[0];
    expect(custom.code).toBe("P22");
    expect(custom).toMatchObject({
      shape: automatic.shape,
      colour: automatic.colour,
      tilt: automatic.tilt,
    });
  });

  it("renders honest empty totals and no invented code for a place without country data", () => {
    const future = trip("Unknown", "", "2027-01-01", "2027-01-02");
    future.stops[0].location.country = "";
    const view = stampsView([future], today, "rolling");
    expect(view.pastTrips).toEqual([]);
    expect(view.totals).toEqual({ trips: 0, places: 0, countries: 0, nights: 0 });
    expect(view.stickers[0].code).toBe("");
  });

  it("filters completed trips by rolling year or calendar year, while keeping future trips", () => {
    const old = trip("Boston", "US", "2024-03-01", "2024-03-04");
    const thisYear = trip("Denver", "US", "2026-02-01", "2026-02-04");
    const future = trip("Tokyo", "JP", "2027-05-01", "2027-05-03");
    expect(tripMatchesFilter(old, "rolling", today)).toBe(false);
    expect(tripMatchesFilter(thisYear, "year", today)).toBe(true);
    expect(tripMatchesFilter(future, "year", today)).toBe(true);
    expect(stampsView([old, thisYear, future], today, "year").pastTrips).toHaveLength(1);
    expect(stampsView([old, thisYear, future], today, "all").pastTrips).toHaveLength(2);
  });

  it("keeps malformed legacy dates honest instead of inventing dates", () => {
    const legacy = trip("Mystery", "", "2026-09-01", "2026-09-02");
    legacy.start = "not-a-date";
    legacy.end = "not-a-date";
    legacy.stops[0].location.region = "";
    legacy.stops[0].location.country = "";

    const view = stampsView([legacy], today, "all");
    expect(view.stickers[0]).toMatchObject({ month: "", monthYear: "Date not set" });
    expect(stampTripView(legacy)).toMatchObject({
      monthYear: "Date not set",
      eyebrow: "DATE NOT SET",
    });
    expect(filterLabel("year", "zzzz")).toBe(String(new Date().getUTCFullYear()));
    expect(tripMatchesFilter(legacy, "year", "zzzz")).toBe(false);
    expect(tripMatchesFilter(legacy, "rolling", "zzzz")).toBe(false);
  });

  it("describes optional route details, short trips and duplicate stops without double counting", () => {
    const dayTrip = trip("Portland", "US", "2026-09-01", "2026-09-01", {
      region: "",
      airportCode: "PDX",
    });
    dayTrip.travelMode = "drive";
    dayTrip.stops.push({ ...dayTrip.stops[0] });
    const overnight = trip("Boston", "US", "2026-08-01", "2026-08-02");
    const unknownCountry = trip("Unknown", "", "2026-07-01", "2026-07-03");
    const noStops = { ...overnight, destination: "Saved destination", stops: [] };

    const view = stampsView([dayTrip, overnight, unknownCountry], today, "all");
    expect(view.stickers).toHaveLength(3);
    expect(view.stickers.find((entry) => entry.place === "Portland")?.region).toBe("UNITED STATES");
    expect(view.totals.countries).toBe(1);
    expect(stampTripView(dayTrip).facts).toContain("drive · PDX · day trip");
    expect(stampTripView(overnight).facts).toContain("1 night");
    expect(stampTripView(noStops)).toMatchObject({
      code: "",
      stickerColour: null,
      name: "Saved destination",
    });
  });

  it("uses the chosen completed visit's stop metadata regardless of input order", () => {
    const completed = trip("Lisbon", "PT", "2026-09-01", "2026-09-08", {
      region: "Lisbon District",
      airportCode: "LIS",
    });
    const future = trip("Lisbon", "PT", "2027-03-01", "2027-03-05", {
      region: "Future Region",
    });

    const completedFirst = stampsView([completed, future], today, "rolling").stickers[0];
    const futureFirst = stampsView([future, completed], today, "rolling").stickers[0];

    expect(completedFirst).toMatchObject({
      code: "LIS",
      region: "LISBON DISTRICT",
      monthYear: "Sep 2026",
      tripId: completed.id,
      upcoming: false,
    });
    expect(futureFirst).toEqual(completedFirst);
  });
});
