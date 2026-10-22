// Turns the OurAirports airports.csv into the compact dataset the stamps use (#152). Pure, so a test can prove which
// rows are kept. scripts/build-airports.ts runs it on a downloaded CSV.

export interface AirportRow {
  iata: string;
  latitude: number;
  longitude: number;
  country: string;
  /** A large airport (not just medium): large outranks medium when a stop has several airports in range (#157). */
  large: boolean;
  /** Length of the airport's longest open runway in feet; 0 when OurAirports lists none. The tie-break after size. */
  runwayFt: number;
}

const KEPT_TYPES: ReadonlySet<string> = new Set(["large_airport", "medium_airport"]);

/** Splits one CSV record, honouring double-quoted fields that contain commas or doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (quoted) {
      if (char === '"' && line[at + 1] === '"') {
        current += '"';
        at++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}

/** Longest open runway per airport ident, in feet, from OurAirports runways.csv. Blank, zero and closed runways are ignored. */
export function longestRunways(runwaysCsv: string): Map<string, number> {
  const [header, ...lines] = runwaysCsv.split(/\r?\n/).filter((line) => line.length > 0);
  const longest = new Map<string, number>();
  if (!header) return longest;
  const columns = parseCsvLine(header);
  const [ident, length, closed] = ["airport_ident", "length_ft", "closed"].map((name) =>
    columns.indexOf(name),
  );
  if ([ident, length, closed].some((at) => at < 0)) return longest;
  for (const line of lines) {
    const fields = parseCsvLine(line);
    if (fields[closed] === "1" || fields[length].trim() === "") continue;
    const feet = Number(fields[length]);
    if (!Number.isFinite(feet) || feet <= 0) continue;
    longest.set(fields[ident], Math.max(longest.get(fields[ident]) ?? 0, Math.round(feet)));
  }
  return longest;
}

/**
 * Keeps airports that have an IATA code and scheduled service and are large or medium. Rows with a malformed code,
 * country or coordinates are dropped, never repaired. Sorted by code so the output is stable.
 */
export function selectAirports(
  csv: string,
  runways: ReadonlyMap<string, number> = new Map(),
): AirportRow[] {
  const [header, ...lines] = csv.split(/\r?\n/).filter((line) => line.length > 0);
  if (!header) return [];
  const columns = parseCsvLine(header);
  const index = (name: string) => columns.indexOf(name);
  const [type, lat, lon, country, service, iata, ident] = [
    "type",
    "latitude_deg",
    "longitude_deg",
    "iso_country",
    "scheduled_service",
    "iata_code",
    "ident",
  ].map(index);
  if ([type, lat, lon, country, service, iata, ident].some((at) => at < 0)) return [];
  const rows = new Map<string, AirportRow>();
  for (const line of lines) {
    const fields = parseCsvLine(line);
    if (!KEPT_TYPES.has(fields[type]) || fields[service] !== "yes") continue;
    const code = fields[iata];
    const cc = fields[country];
    // Number("") is 0, so a blank coordinate must be refused before it becomes a point off West Africa.
    if (fields[lat].trim() === "" || fields[lon].trim() === "") continue;
    const latitude = Number(fields[lat]);
    const longitude = Number(fields[lon]);
    if (!/^[A-Z]{3}$/.test(code) || !/^[A-Z]{2}$/.test(cc)) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    if (rows.has(code)) continue;
    rows.set(code, {
      large: fields[type] === "large_airport",
      runwayFt: runways.get(fields[ident]) ?? 0,
      iata: code,
      latitude: Math.round(latitude * 1000) / 1000,
      longitude: Math.round(longitude * 1000) / 1000,
      country: cc,
    });
  }
  return [...rows.values()].sort((a, b) => a.iata.localeCompare(b.iata));
}

/** One record per airport, "LIS 38.781 -9.136 PT L 12467" (L large, M medium, longest runway in feet), joined by "|". */
export function encodeAirports(rows: readonly AirportRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.iata} ${row.latitude} ${row.longitude} ${row.country} ${row.large ? "L" : "M"} ${row.runwayFt}`,
    )
    .join("|");
}

export function decodeAirports(encoded: string): AirportRow[] {
  if (!encoded) return [];
  return encoded.split("|").map((record) => {
    const [iata, latitude, longitude, country, size, runway] = record.split(" ");
    return {
      iata,
      latitude: Number(latitude),
      longitude: Number(longitude),
      country,
      large: size === "L",
      runwayFt: Number(runway) || 0,
    };
  });
}
