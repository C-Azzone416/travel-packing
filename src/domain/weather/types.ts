export type WeatherSource = "forecast" | "typical";
export interface DayWeather {
  date: string; // YYYY-MM-DD
  stopIndex: number;
  source: WeatherSource;
  highC: number;
  lowC: number;
  precipProbability: number; // 0..1 (typical: share of wet years)
  precipMm: number;
  snowCm: number;
  uvIndexMax: number | null; // null when unknown (typical)
  sunshineHours: number | null; // proxy when UV unknown
}
export interface StopWeather {
  stopIndex: number;
  status: "ok" | "unavailable";
  days: DayWeather[];
}
