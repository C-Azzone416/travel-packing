export type WeatherEvent =
  | "request"
  | "cache-hit"
  | "provider-error"
  | "invalid-trip"
  | "not-found"
  | "opted-out"
  | "rate-limited";
export type WeatherLogSink = (line: string) => void;

const defaultSink: WeatherLogSink = (line) => console.info(line);
let sink: WeatherLogSink = defaultSink;

/** Test hook. The closed event set makes sensitive values impossible to pass to this logger. */
export function setWeatherLogSink(next?: WeatherLogSink): void {
  sink = next ?? defaultSink;
}

export function logWeatherEvent(event: WeatherEvent): void {
  sink(JSON.stringify({ scope: "weather", event }));
}
