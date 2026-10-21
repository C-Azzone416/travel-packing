import { describe, expect, it } from "vitest";
import { selectStamps, stampLabelSize, stampsAriaLabel } from "./stamps";
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

describe("selectStamps", () => {
  it("gives a first-city stamp for an empty list, with no label", () => {
    expect(selectStamps([])).toEqual([{ kind: "city", label: "", fullName: "" }]);
  });

  it("gives one first-city stamp for a single stop", () => {
    expect(selectStamps([stop("Lisbon", "PT")])).toEqual([
      { kind: "city", label: "LISBON", fullName: "LISBON" },
    ]);
  });

  it("gives one first-city stamp when every stop is the same city, even with differing case or space", () => {
    expect(labels([stop("Lisbon", "PT"), stop(" lisbon ", "ES")])).toEqual(["LISBON"]);
  });

  it("gives one country stamp when all stops share a country", () => {
    expect(selectStamps([stop("Lisbon", "pt"), stop("Porto", "PT")])).toEqual([
      { kind: "country", label: "PRT", fullName: "PRT" },
    ]);
  });

  it("gives two stamps in route order for two countries, the second overlapping", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "ES")])).toEqual(["PRT", "ESP"]);
    expect(labels([stop("Madrid", "ES"), stop("Lisbon", "PT")])).toEqual(["ESP", "PRT"]);
  });

  it("gives two stamps for A→B→A, de-duplicated", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "ES"), stop("Porto", "PT")])).toEqual([
      "PRT",
      "ESP",
    ]);
  });

  it("falls back to the first city for three or more countries", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "ES"), stop("Paris", "FR")])).toEqual([
      "LISBON",
    ]);
  });

  it("falls back to the first city when any code is not in the table, never a subset", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Atlantis", "ZZ")])).toEqual(["LISBON"]);
  });

  it("falls back to the first city when any code is missing or empty", () => {
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", undefined)])).toEqual(["LISBON"]);
    expect(labels([stop("Lisbon", "PT"), stop("Madrid", "")])).toEqual(["LISBON"]);
  });

  it("truncates long city names at 9 characters with an ellipsis, keeping the full name", () => {
    expect(selectStamps([stop("Johannesburg", "ZA")])).toEqual([
      { kind: "city", label: "JOHANNESB…", fullName: "JOHANNESBURG" },
    ]);
    expect(labels([stop("Amsterdam", "NL")])).toEqual(["AMSTERDAM"]);
    expect(labels([stop("Amsterdam1", "NL")])).toEqual(["AMSTERDAM…"]);
  });
});

describe("selectStamps with airport codes (#152)", () => {
  it("shows the airport code on a single-city stamp, keeping the city name for the accessible label", () => {
    const stamps = selectStamps([stop("Lisbon", "PT", "LIS")]);
    expect(stamps).toEqual([{ kind: "city", label: "LIS", fullName: "LISBON" }]);
    expect(stampsAriaLabel(stamps)).toBe("LISBON departure stamp");
  });

  it("uses the first stop's code in every city fallback", () => {
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Lisbon", "ES", "MAD")])).toEqual(["LIS"]);
    expect(
      labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", "ES", "MAD"), stop("Paris", "FR")]),
    ).toEqual(["LIS"]);
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Atlantis", "ZZ")])).toEqual(["LIS"]);
  });

  it("keeps the city name when the first stop has no code, even if a later stop has one", () => {
    expect(
      labels([stop("Lisbon", "PT"), stop("Madrid", "ES", "MAD"), stop("Paris", "FR")]),
    ).toEqual(["LISBON"]);
  });

  it("never shows a code on country stamps", () => {
    expect(labels([stop("Lisbon", "PT", "LIS"), stop("Madrid", "ES", "MAD")])).toEqual([
      "PRT",
      "ESP",
    ]);
  });

  it("ignores a code that is not three capital letters", () => {
    for (const bad of ["lis", "LI", "LISB", "L1S"]) {
      expect(labels([stop("Lisbon", "PT", bad)])).toEqual(["LISBON"]);
    }
  });
});

describe("stampLabelSize", () => {
  it("steps large (≤5), medium (6–7) and small (8–9), ignoring the ellipsis", () => {
    expect(stampLabelSize("PRT")).toBe("large");
    expect(stampLabelSize("PARIS")).toBe("large");
    expect(stampLabelSize("LISBON")).toBe("medium");
    expect(stampLabelSize("BERGENS")).toBe("medium");
    expect(stampLabelSize("REYKJAVIK")).toBe("small");
    expect(stampLabelSize("AMSTERDAM…")).toBe("small");
  });
});

describe("stampsAriaLabel", () => {
  it("names country stamps as a route and city stamps as a departure", () => {
    expect(stampsAriaLabel(selectStamps([stop("Lisbon", "PT"), stop("Madrid", "ES")]))).toBe(
      "PRT, ESP route stamps",
    );
    expect(stampsAriaLabel(selectStamps([stop("Lisbon", "PT")]))).toBe("LISBON departure stamp");
  });

  it("uses the untruncated city name", () => {
    expect(stampsAriaLabel(selectStamps([stop("Johannesburg", "ZA")]))).toBe(
      "JOHANNESBURG departure stamp",
    );
  });
});
