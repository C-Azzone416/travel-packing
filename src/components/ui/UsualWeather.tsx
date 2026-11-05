// The "not live" weather blocks (Suitcase P3, #408; spec #393 s1.2 to 1.7). They stand in for the forecast before it
// opens and when weather is off. The dashed border says "not live" to the eye; the words say it to everyone: the
// heading reads "Usual weather, not a forecast" and the open date is plain text. Never ALERT, never day tiles.

import Link from "next/link";
import { forecastOpens } from "@/lib/trip-phase-copy";

export const USUAL_WEATHER_NOTE =
  "Averages from the last 5 years. The real forecast replaces this 16 days before you go, and weather items get suggested then.";
export const WEATHER_OFF_TEXT =
  "Turn on weather in Settings to see the forecast and get rain, cold and heat reminders.";

export interface UsualWeatherRow {
  id: string;
  city: string;
  /** "14 – 24 Mar" */
  dates: string;
  /** The usual line, e.g. "usually mild, about 3 rainy days". */
  line?: string;
  /** "64° / 51°" in the account's unit. */
  range?: string;
  /** Weather is on but the provider has nothing for this stop: shows the "isn't available" line, no range. */
  unavailable?: boolean;
}

function CloudSun() {
  return (
    <svg
      className="usual-weather-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M2.5 8H1M3.9 3.9l1 1M12.1 3.9l-1 1" />
      <path d="M8 19h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8 13.5 2.75 2.75 0 0 0 8 19z" />
    </svg>
  );
}

export interface UsualWeatherBlockProps {
  /** The trip's first day: the forecast opens 15 days before it. */
  start: string;
  /** Device-local today. */
  today: string;
  rows: readonly UsualWeatherRow[];
  /** `h2` for the laptop block, `h3` inside a card. */
  headingLevel?: 2 | 3;
  /** Set false to leave out the footer note (the phone card shows it once, below the rows). */
  showNote?: boolean;
}

export function UsualWeatherBlock({
  start,
  today,
  rows,
  headingLevel = 2,
  showNote = true,
}: UsualWeatherBlockProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const opens = forecastOpens(start, today);
  return (
    <section className="usual-weather" data-testid="usual-weather">
      <Heading className="usual-weather-eyebrow">
        <span>Usual weather</span>
        <span className="sr-only">, not a forecast</span>
        {opens ? <span aria-hidden="true"> · </span> : null}
        {opens ? <span data-testid="forecast-opens">Forecast opens {opens.text}</span> : null}
      </Heading>
      <ul className="usual-weather-rows">
        {rows.map((row) => (
          <li
            key={row.id}
            className="usual-weather-row"
            data-unavailable={row.unavailable || undefined}
          >
            <CloudSun />
            <div className="usual-weather-body">
              <p className="usual-weather-city">
                <strong>{row.city}</strong> <span className="usual-weather-dates">{row.dates}</span>
              </p>
              {row.unavailable ? (
                <p className="usual-weather-line">
                  Weather isn&rsquo;t available for {row.city} right now.
                </p>
              ) : row.line ? (
                <p className="usual-weather-line">{row.line}</p>
              ) : null}
            </div>
            {row.range && !row.unavailable ? (
              <p className="usual-weather-range">{row.range}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {showNote ? <p className="usual-weather-note">{USUAL_WEATHER_NOTE}</p> : null}
    </section>
  );
}

export interface WeatherOffBlockProps {
  headingLevel?: 2 | 3;
  settingsHref?: string;
}

/** Weather turned off in Settings: the same dashed box, no temperatures, and a way to turn it on. Every phase. */
export function WeatherOffBlock({
  headingLevel = 2,
  settingsHref = "/settings",
}: WeatherOffBlockProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="usual-weather" data-testid="weather-off">
      <Heading className="usual-weather-eyebrow">Weather is off</Heading>
      <div className="usual-weather-row usual-weather-off-row">
        <div className="usual-weather-body">
          <p className="usual-weather-line">{WEATHER_OFF_TEXT}</p>
          <Link className="usual-weather-link" href={settingsHref}>
            Open Settings
          </Link>
        </div>
      </div>
    </section>
  );
}
