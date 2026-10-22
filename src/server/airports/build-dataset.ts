// Turns the OurAirports airports.csv into the compact dataset the stamps use (#152). Pure, so a test can prove which
// rows are kept. scripts/build-airports.ts runs it on a downloaded CSV.

export interface AirportRow {
  iata: string;
  latitude: number;
  longitude: number;
  country: string;
  /** A large airport (not just medium): the only kind that makes a stop ambiguous across the wider ring (#152). */
  large: boolean;
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

/**
 * Keeps airports that have an IATA code and scheduled service and are large or medium. Rows with a malformed code,
 * country or coordinates are dropped, never repaired. Sorted by code so the output is stable.
 */
export function selectAirports(csv: string): AirportRow[] {
  const [header, ...lines] = csv.split(/\r?\n/).filter((line) => line.length > 0);
  if (!header) return [];
  const columns = parseCsvLine(header);
  const index = (name: string) => columns.indexOf(name);
  const [type, lat, lon, country, service, iata] = [
    "type",
    "latitude_deg",
    "longitude_deg",
    "iso_country",
    "scheduled_service",
    "iata_code",
  ].map(index);
  if ([type, lat, lon, country, service, iata].some((at) => at < 0)) return [];
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
      iata: code,
      latitude: Math.round(latitude * 1000) / 1000,
      longitude: Math.round(longitude * 1000) / 1000,
      country: cc,
    });
  }
  return [...rows.values()].sort((a, b) => a.iata.localeCompare(b.iata));
}

/** One record per airport, "LIS 38.781 -9.136 PT L" (L large, M medium), joined by "|". */
export function encodeAirports(rows: readonly AirportRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.iata} ${row.latitude} ${row.longitude} ${row.country} ${row.large ? "L" : "M"}`,
    )
    .join("|");
}

export function decodeAirports(encoded: string): AirportRow[] {
  if (!encoded) return [];
  return encoded.split("|").map((record) => {
    const [iata, latitude, longitude, country, size] = record.split(" ");
    return {
      iata,
      latitude: Number(latitude),
      longitude: Number(longitude),
      country,
      large: size === "L",
    };
  });
}
