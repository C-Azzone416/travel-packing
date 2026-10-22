import { describe, expect, it } from "vitest";
import { automaticStamps, normaliseStampLabel, selectStamps, stampsAriaLabel } from "./stamps";
import type { TripStop } from "./trip-stops";

function stop(city: string, countryCode: string | undefined, airportCode?: string): TripStop {
  return {
    ...(airportCode ? { airportCode } : {}),
    location: {
      id: city,
      city,
      region: "",
      country: "",
      countryCode: countryCode as string,
      label: city,
    },
    arrive: "2026-11-01",
    leave: "2026-11-03",
  };
}

const labels = (stops: TripStop[]) => selectStamps(stops).map((s) => s.label);

describe("selectStamps: the country route stamps", () => {
  it("gives one country stamp when all stops share a country", () => {
    expect(selectStamps([stop("Lisbon", "pt"), stop("Porto", "PT")])).toEqual([
      { kind: "country", label: "PRT" },
    ]);
  });

  it("gives two stamps in route order for two countries", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "ES")])).toEqual(["PRT", "ESP"]);
    expect(labels([stop("Madrid", "ES"), stop("Lisbon", "PT")])).toEqual(["ESP", "PRT"]);
  });

  it("gives two stamps for A→B→A, de-duplicated", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "ES"), stop("Porto", "PT")])).toEqual([
      "PRT",
      "ESP",
    ]);
  });

  it("never shows an airport code on a country stamp", () => {
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", "ES", "MAD")])).toEqual([
      "PRT",
      "ESP",
    ]);
  });
});

describe("selectStamps: the first stop's stamp (single city and every fallback)", () => {
  it("shows the airport code when the stop has one, naming the city in the accessible label", () => {
    const stamps = selectStamps([stop("Lisbon", "PT", "LIS")]);
    expect(stamps).toEqual([{ kind: "airport", label: "LIS", cityName: "Lisbon" }]);
    expect(stampsAriaLabel(stamps)).toBe("LIS airport, Lisbon, departure stamp");
  });

  it("uses the country's alpha-3 when the stop has no airport (Zermatt → CHE)", () => {
    const stamps = selectStamps([stop("Zermatt", "CH")]);
    expect(stamps).toEqual([{ kind: "place", label: "CHE", cityName: "Zermatt" }]);
    expect(stampsAriaLabel(stamps)).toBe("CHE, Zermatt, departure stamp");
  });

  it("treats a lower-case or padded country code the same way", () => {
    expect(labels([stop("Zermatt", " ch ")])).toEqual(["CHE"]);
  });

  it("gives one first-stop stamp when every stop is the same city, even with differing case or space", () => {
    expect(labels([stop("Lisbon", "PT", "LIS"), stop(" lisbon ", "ES")])).toEqual(["LIS"]);
  });

  it("uses the first stop's code in every fallback: three countries, an unknown or a missing code", () => {
    expect(
      labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", "ES", "MAD"), stop("Paris", "FR")]),
    ).toEqual(["LIS"]);
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Atlantis", "ZZ")])).toEqual(["LIS"]);
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", undefined)])).toEqual(["LIS"]);
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", "")])).toEqual(["LIS"]);
  });

  it("falls back to the first stop's country when it has no airport, even if a later stop has one", () => {
    expect(
      labels([stop("Zermatt", "CH"), stop("Madrid", "ES", "MAD"), stop("Paris", "FR")]),
    ).toEqual(["CHE"]);
  });

  it("marks an airport code that equals a country code (FRA, AUS) as an airport, not a country", () => {
    const [frankfurt] = selectStamps([stop("Frankfurt", "DE", "FRA")]);
    const [france] = selectStamps([stop("Paris", "FR"), stop("Nice", "FR")]);
    expect(frankfurt).toMatchObject({ label: "FRA", kind: "airport" });
    expect(france).toMatchObject({ label: "FRA", kind: "country" });
    expect(stampsAriaLabel([frankfurt])).toBe("FRA airport, Frankfurt, departure stamp");
    expect(stampsAriaLabel([france])).toBe("FRA route stamps");
  });

  it("ignores an airport code that is not three capital letters and uses the country instead", () => {
    for (const bad of ["lis", "LI", "LISB", "L1S"]) {
      expect(selectStamps([stop("Lisbon", "PT", bad)])).toEqual([
        { kind: "place", label: "PRT", cityName: "Lisbon" },
      ]);
    }
  });

  it("gives no stamp when the first stop has neither an airport nor a valid country (never invented, never from the city)", () => {
    expect(selectStamps([stop("Atlantis", "ZZ")])).toEqual([]);
    expect(selectStamps([stop("Nowhere", undefined)])).toEqual([]);
    expect(selectStamps([stop("Lisbon", "PT"), stop("Atlantis", "ZZ")])).toEqual([
      { kind: "place", label: "PRT", cityName: "Lisbon" },
    ]);
    expect(selectStamps([stop("Atlantis", "ZZ"), stop("Lisbon", "PT")])).toEqual([]);
  });

  it("gives no stamp for an empty list", () => {
    expect(selectStamps([])).toEqual([]);
  });

  it("every label is exactly three characters", () => {
    const cases = [
      [stop("Lisbon", "PT", "LIS")],
      [stop("Zermatt", "CH")],
      [stop("Johannesburg", "ZA")],
      [stop("Lisbon", "PT"), stop("Madrid", "ES")],
      [stop("Lisbon", "PT"), stop("Madrid", "ES"), stop("Paris", "FR")],
    ];
    for (const stops of cases)
      for (const stamp of selectStamps(stops)) expect(stamp.label).toMatch(/^[A-Z]{3}$/);
  });
});

describe("stampsAriaLabel", () => {
  it("is empty for no stamps, and drops a missing city name cleanly", () => {
    expect(stampsAriaLabel([])).toBe("");
    expect(stampsAriaLabel([{ kind: "airport", label: "LIS", cityName: "" }])).toBe(
      "LIS airport, departure stamp",
    );
    expect(stampsAriaLabel([{ kind: "place", label: "CHE" }])).toBe("CHE, departure stamp");
  });
});

describe("normaliseStampLabel (#151)", () => {
  it.each([
    ["abc", "ABC"],
    ["  ab1 ", "AB1"],
    ["7X9", "7X9"],
    ["", null],
    ["   ", null],
  ])("accepts %j as %j", (raw, label) => {
    expect(normaliseStampLabel(raw)).toEqual({ ok: true, label });
  });

  it.each(["AB", "ABCD", "A C", "A-C", "ÀBC", "ABÇ", "AB😀", "A\nB", "ab cd"])(
    "refuses %j",
    (raw) => {
      expect(normaliseStampLabel(raw)).toEqual({ ok: false });
    },
  );
});

describe("selectStamps with the owner's overrides (#151)", () => {
  const lisbonMadrid = [stop("Lisbon", "PT"), stop("Madrid", "ES")];

  it("is the automatic result with no override, or with only nulls", () => {
    expect(selectStamps(lisbonMadrid)).toEqual(automaticStamps(lisbonMadrid));
    expect(selectStamps(lisbonMadrid, [null, null])).toEqual(automaticStamps(lisbonMadrid));
  });

  it("replaces slot 1, slot 2, or both, in route order, as custom stamps", () => {
    const first = selectStamps(lisbonMadrid, ["AAA", null]);
    expect(first.map((s) => [s.kind, s.label])).toEqual([
      ["custom", "AAA"],
      ["country", "ESP"],
    ]);
    expect(selectStamps(lisbonMadrid, [null, "BBB"]).map((s) => [s.kind, s.label])).toEqual([
      ["country", "PRT"],
      ["custom", "BBB"],
    ]);
    expect(selectStamps(lisbonMadrid, ["AAA", "BBB"]).map((s) => s.label)).toEqual(["AAA", "BBB"]);
  });

  it("overrides a single airport stamp, which then no longer claims to be an airport", () => {
    const stamps = selectStamps([stop("Lisbon", "PT", "LIS")], ["ABC", null]);
    expect(stamps).toEqual([{ kind: "custom", label: "ABC", cityName: "Lisbon" }]);
    expect(stampsAriaLabel(stamps)).toBe("ABC, Lisbon, departure stamp");
  });

  it("ignores slot 2 when the automatic result has one stamp", () => {
    expect(selectStamps([stop("Lisbon", "PT", "LIS")], [null, "ZZZ"])).toEqual(
      automaticStamps([stop("Lisbon", "PT", "LIS")]),
    );
  });

  it("makes one custom stamp when there is no automatic stamp but slot 1 has an override", () => {
    const noCountry = [stop("Nowhere", undefined)];
    expect(selectStamps(noCountry)).toEqual([]);
    expect(selectStamps(noCountry, [null, "ZZZ"])).toEqual([]);
    expect(selectStamps(noCountry, ["ABC", "ZZZ"])).toEqual([
      { kind: "custom", label: "ABC", cityName: "Nowhere" },
    ]);
  });

  it("names the full effective text for two stamps, custom or not", () => {
    expect(stampsAriaLabel(selectStamps(lisbonMadrid, ["AAA", null]))).toBe(
      "AAA, ESP route stamps",
    );
    expect(stampsAriaLabel(selectStamps(lisbonMadrid, ["AAA", "BBB"]))).toBe(
      "AAA, BBB route stamps",
    );
  });
});
