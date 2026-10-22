import { describe, expect, it } from "vitest";
import { selectStamps, stampsAriaLabel } from "./stamps";
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
