import { describe, expect, it } from "vitest";
import { buildTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import { stampSlotForStop } from "@/domain/stamps";
import type { SampleLocation } from "@/domain/trip-stops";
import {
  filterLabel,
  placeHash,
  stampTripView,
  stickerEditable,
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
    expect(stampTripView(legacy, today)).toMatchObject({
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
    expect(stampTripView(dayTrip, today).facts).toContain("drive · PDX · day trip");
    expect(stampTripView(overnight, today).facts).toContain("1 night");
    expect(stampTripView(noStops, today)).toMatchObject({
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

describe("the rolling window's boundaries (#446)", () => {
  it("includes a trip that starts exactly one year before today, and excludes one that starts the day before", () => {
    const today = "2026-10-16";
    const onBoundary = trip("Boston", "US", "2025-10-16", "2025-10-18");
    const dayBefore = trip("Denver", "US", "2025-10-15", "2025-10-17");
    expect(tripMatchesFilter(onBoundary, "rolling", today)).toBe(true);
    expect(tripMatchesFilter(dayBefore, "rolling", today)).toBe(false);
    const view = stampsView([dayBefore, onBoundary], today, "rolling");
    expect(view.pastTrips.map((entry) => entry.id)).toEqual([onBoundary.id]);
  });

  it("keeps a trip that starts today under every filter, including a day trip taken today", () => {
    const today = "2026-10-16";
    const starts = trip("Lisbon", "PT", "2026-10-16", "2026-10-19");
    const dayTrip = trip("Porto", "PT", "2026-10-16", "2026-10-16");
    for (const filter of ["rolling", "year"] as const) {
      expect(tripMatchesFilter(starts, filter, today)).toBe(true);
      expect(tripMatchesFilter(dayTrip, filter, today)).toBe(true);
    }
    const view = stampsView([starts, dayTrip], today, "rolling");
    expect(view.stickers).toHaveLength(2);
    expect(view.stickers.every((entry) => entry.upcoming)).toBe(true);
    expect(view.pastTrips).toEqual([]);
  });

  it("on a Feb 29 today the window rolls to Mar 1 of last year (setUTCFullYear), inclusive at that date", () => {
    // 2028 is a leap year. One year earlier is Feb 29 2027, which does not exist, so the rolling start
    // lands on Mar 1 2027 and a trip that started Feb 28 2027 falls outside the window.
    const today = "2028-02-29";
    const onMarch1 = trip("Boston", "US", "2027-03-01", "2027-03-03");
    const febEnd = trip("Denver", "US", "2027-02-28", "2027-03-01");
    expect(tripMatchesFilter(onMarch1, "rolling", today)).toBe(true);
    expect(tripMatchesFilter(febEnd, "rolling", today)).toBe(false);
    expect(
      stampsView([onMarch1, febEnd], today, "rolling").pastTrips.map((entry) => entry.id),
    ).toEqual([onMarch1.id]);
  });

  describe("which label slot a sticker reads (#494)", () => {
    const today = "2026-10-16";
    // Two countries: the route shows two stamps, slot 1 for the first stop and slot 2 for the second.
    function twoCountries(labels: [string | null, string | null]) {
      const route = trip("Lisbon", "PT", "2026-09-01", "2026-09-05");
      route.stops.push({ ...route.stops[0], location: place("Austin", "US") });
      route.stampLabels = labels;
      return route;
    }
    const codeOf = (route: LifecycleTrip, city: string) =>
      stampsView([route], today, "all").stickers.find((entry) => entry.place === city)?.code;

    it("shows the second slot's label only on the second stop's sticker", () => {
      const route = twoCountries([null, "QQQ"]);
      expect(codeOf(route, "Austin")).toBe("QQQ");
      expect(codeOf(route, "Lisbon")).not.toBe("QQQ");
    });

    it("shows the first slot's label only on the first stop's sticker", () => {
      const route = twoCountries(["ZZZ", null]);
      expect(codeOf(route, "Lisbon")).toBe("ZZZ");
      expect(codeOf(route, "Austin")).not.toBe("ZZZ");
    });

    // The country of each stop in a route, as a trip whose stamps follow those countries.
    const route = (...countries: Array<"PT" | "ES" | "US">) => {
      const first = trip("Lisbon", "PT", "2026-09-01", "2026-09-05");
      const names = {
        PT: ["Lisbon", "Porto", "Faro"],
        ES: ["Madrid", "Barcelona", "Sevilla"],
        US: ["Austin", "Boston", "Denver"],
      };
      const used = { PT: 0, ES: 0, US: 0 };
      first.stops = countries.map((code) => ({
        ...first.stops[0],
        location: place(names[code][used[code]++], code),
      }));
      return first;
    };
    const slots = (...countries: Array<"PT" | "ES" | "US">) => {
      const r = route(...countries);
      return r.stops.map((_, index) => stampSlotForStop(r.stops, index));
    };

    it("maps every stop to ONE label slot, whether or not stop and stamp indices coincide", () => {
      expect(slots("PT", "ES")).toEqual([0, 1]);
      expect(slots("PT", "PT", "ES")).toEqual([0, 0, 1]);
      expect(slots("PT", "ES", "ES")).toEqual([0, 1, 1]);
      expect(slots("PT", "ES", "PT")).toEqual([0, 1, 0]);
      expect(slots("PT", "PT")).toEqual([0, 0]);
      // Three countries show one departure stamp: later stops have no slot.
      expect(slots("PT", "ES", "US")).toEqual([0, null, null]);
      expect(stampSlotForStop([], 0)).toBeNull();
      expect(stampSlotForStop(route("PT").stops, 5)).toBeNull();
    });

    it("lets a write change exactly the stickers of the slot it writes (PT, PT, ES and PT, ES, ES)", () => {
      const pte = route("PT", "PT", "ES");
      pte.stampLabels = [null, "QQQ"];
      expect([codeOf(pte, "Lisbon"), codeOf(pte, "Porto"), codeOf(pte, "Madrid")]).toEqual([
        stampsView([route("PT", "PT", "ES")], today, "all").stickers.find(
          (e) => e.place === "Lisbon",
        )?.code,
        stampsView([route("PT", "PT", "ES")], today, "all").stickers.find(
          (e) => e.place === "Porto",
        )?.code,
        "QQQ",
      ]);
      pte.stampLabels = ["ZZZ", null];
      expect([codeOf(pte, "Lisbon"), codeOf(pte, "Porto"), codeOf(pte, "Madrid")]).toEqual([
        "ZZZ",
        "ZZZ",
        codeOf(route("PT", "PT", "ES"), "Madrid"),
      ]);
      const pee = route("PT", "ES", "ES");
      pee.stampLabels = [null, "QQQ"];
      expect(codeOf(pee, "Madrid")).toBe("QQQ");
      expect(codeOf(pee, "Barcelona")).toBe("QQQ");
      expect(codeOf(pee, "Lisbon")).not.toBe("QQQ");
    });

    it("calls a sticker editable exactly when it has a slot", () => {
      const pte = route("PT", "PT", "ES");
      expect([0, 1, 2].map((index) => stickerEditable(pte, index))).toEqual([true, true, true]);
      const three = route("PT", "ES", "US");
      expect([0, 1, 2].map((index) => stickerEditable(three, index))).toEqual([true, false, false]);
      expect(stickerEditable({ ...pte, stops: [] }, 0)).toBe(false);
    });
  });
});
