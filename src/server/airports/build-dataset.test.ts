import { describe, expect, it } from "vitest";
import {
  decodeAirports,
  encodeAirports,
  longestRunways,
  parseCsvLine,
  selectAirports,
} from "./build-dataset";

const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code"';
const row = (
  type: string,
  lat: string,
  lon: string,
  country: string,
  service: string,
  iata: string,
  name = "Test",
  ident = "X",
) =>
  `1,"${ident}","${type}","${name}",${lat},${lon},10,"EU","${country}","XX-XX","Town","${service}",,"${iata}"`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseCsvLine", () => {
  it("splits plain fields, keeps empty ones, and honours quoted commas and doubled quotes", () => {
    expect(parseCsvLine('a,,"b, c","say ""hi"""')).toEqual(["a", "", "b, c", 'say "hi"']);
    expect(parseCsvLine("")).toEqual([""]);
  });
});

describe("selectAirports", () => {
  it("keeps large and medium airports with scheduled service and an IATA code, rounded and sorted", () => {
    const kept = selectAirports(
      csv(
        row("large_airport", "38.78131", "-9.13592", "PT", "yes", "LIS"),
        row("medium_airport", "41.2481", "-8.68138", "PT", "yes", "OPO", 'Porto, "Sá Carneiro"'),
      ),
    );
    expect(kept).toEqual([
      { iata: "LIS", latitude: 38.781, longitude: -9.136, country: "PT", large: true, runwayFt: 0 },
      {
        iata: "OPO",
        latitude: 41.248,
        longitude: -8.681,
        country: "PT",
        large: false,
        runwayFt: 0,
      },
    ]);
  });

  it("drops small airports, heliports, no scheduled service and rows with no IATA code", () => {
    expect(
      selectAirports(
        csv(
          row("small_airport", "1", "1", "PT", "yes", "AAA"),
          row("heliport", "1", "1", "PT", "yes", "BBB"),
          row("large_airport", "1", "1", "PT", "no", "CCC"),
          row("large_airport", "1", "1", "PT", "yes", ""),
        ),
      ),
    ).toEqual([]);
  });

  it("drops rows with a malformed code, country or coordinates instead of repairing them", () => {
    expect(
      selectAirports(
        csv(
          row("large_airport", "1", "1", "PT", "yes", "lis"),
          row("large_airport", "1", "1", "PT", "yes", "LISB"),
          row("large_airport", "1", "1", "Portugal", "yes", "LIS"),
          row("large_airport", "", "1", "PT", "yes", "LIS"),
          row("large_airport", "abc", "1", "PT", "yes", "LIS"),
          row("large_airport", "91", "1", "PT", "yes", "LIS"),
          row("large_airport", "1", "181", "PT", "yes", "LIS"),
        ),
      ),
    ).toEqual([]);
  });

  it("keeps the first row for a repeated code", () => {
    const kept = selectAirports(
      csv(
        row("large_airport", "10", "10", "PT", "yes", "DUP"),
        row("large_airport", "20", "20", "ES", "yes", "DUP"),
      ),
    );
    expect(kept).toEqual([
      { iata: "DUP", latitude: 10, longitude: 10, country: "PT", large: true, runwayFt: 0 },
    ]);
  });

  it("returns nothing for an empty file or one missing a needed column", () => {
    expect(selectAirports("")).toEqual([]);
    expect(selectAirports('"id","ident"\n1,"X"')).toEqual([]);
  });

  it("copes with Windows line endings", () => {
    const text = csv(row("large_airport", "1", "2", "PT", "yes", "LIS")).replace(/\n/g, "\r\n");
    expect(selectAirports(text)).toHaveLength(1);
  });
});

describe("encodeAirports / decodeAirports", () => {
  it("round-trips, and an empty dataset decodes to nothing", () => {
    const rows = [
      {
        iata: "LIS",
        latitude: 38.781,
        longitude: -9.136,
        country: "PT",
        large: true,
        runwayFt: 12467,
      },
      {
        iata: "SYD",
        latitude: -33.946,
        longitude: 151.177,
        country: "AU",
        large: false,
        runwayFt: 0,
      },
    ];
    expect(encodeAirports(rows)).toBe("LIS 38.781 -9.136 PT L 12467|SYD -33.946 151.177 AU M 0");
    expect(decodeAirports(encodeAirports(rows))).toEqual(rows);
    expect(decodeAirports("")).toEqual([]);
  });
});

describe("longestRunways", () => {
  const RUNWAY_HEADER =
    '"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed"';
  const runway = (ident: string, length: string, closed = "0") =>
    `1,1,"${ident}",${length},150,"ASP",1,${closed}`;
  const runways = (...rows: string[]) => [RUNWAY_HEADER, ...rows].join("\n");

  it("keeps the longest open runway per airport", () => {
    const longest = longestRunways(
      runways(runway("LPPT", "7874"), runway("LPPT", "12467"), runway("LPPR", "9843")),
    );
    expect(longest.get("LPPT")).toBe(12467);
    expect(longest.get("LPPR")).toBe(9843);
  });

  it("ignores closed, blank, zero and non-numeric runways", () => {
    const longest = longestRunways(
      runways(
        runway("AAAA", "15000", "1"),
        runway("AAAA", ""),
        runway("AAAA", "0"),
        runway("AAAA", "abc"),
        runway("AAAA", "4000"),
      ),
    );
    expect(longest.get("AAAA")).toBe(4000);
    expect(longestRunways(runways(runway("BBBB", ""))).has("BBBB")).toBe(false);
  });

  it("returns nothing for an empty file or one missing a column", () => {
    expect(longestRunways("").size).toBe(0);
    expect(longestRunways('"id","airport_ident"\n1,"X"').size).toBe(0);
  });
});

describe("selectAirports with runways", () => {
  it("joins the longest runway on the airport ident, 0 when none is listed", () => {
    const kept = selectAirports(
      csv(
        row("large_airport", "38.78", "-9.13", "PT", "yes", "LIS", "Lisbon", "LPPT"),
        row("medium_airport", "41.24", "-8.68", "PT", "yes", "OPO", "Porto", "LPPR"),
      ),
      new Map([["LPPT", 12467]]),
    );
    expect(kept.map((entry) => [entry.iata, entry.runwayFt])).toEqual([
      ["LIS", 12467],
      ["OPO", 0],
    ]);
  });
});
