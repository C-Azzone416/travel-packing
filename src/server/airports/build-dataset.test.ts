import { describe, expect, it } from "vitest";
import { decodeAirports, encodeAirports, parseCsvLine, selectAirports } from "./build-dataset";

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
) =>
  `1,"X","${type}","${name}",${lat},${lon},10,"EU","${country}","XX-XX","Town","${service}",,"${iata}"`;
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
      { iata: "LIS", latitude: 38.781, longitude: -9.136, country: "PT" },
      { iata: "OPO", latitude: 41.248, longitude: -8.681, country: "PT" },
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
    expect(kept).toEqual([{ iata: "DUP", latitude: 10, longitude: 10, country: "PT" }]);
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
      { iata: "LIS", latitude: 38.781, longitude: -9.136, country: "PT" },
      { iata: "SYD", latitude: -33.946, longitude: 151.177, country: "AU" },
    ];
    expect(encodeAirports(rows)).toBe("LIS 38.781 -9.136 PT|SYD -33.946 151.177 AU");
    expect(decodeAirports(encodeAirports(rows))).toEqual(rows);
    expect(decodeAirports("")).toEqual([]);
  });
});
