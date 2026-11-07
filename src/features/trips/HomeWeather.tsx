"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { UsualWeatherBlock, WeatherOffBlock } from "@/components/ui/UsualWeather";
import { WeatherDayTile } from "@/components/suitcase";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import {
  alertHeading,
  usualRows,
  type CityWeather,
  type HeroWeather,
  type HomeModel,
} from "./home-view";
import styles from "./HomeWeather.module.css";

function CityRows({
  rows,
  weatherLabel,
  weatherItems,
  pending,
  tripId,
  exclusive,
}: {
  /** Phone: one city open at a time (#376 part 2 section 6); the laptop lets each city open on its own. */
  exclusive: boolean;
  rows: readonly CityWeather[];
  weatherLabel: string | null;
  weatherItems: number;
  /** Weather changes still to review, by stop index. */
  pending: Readonly<Record<number, number>>;
  tripId: string;
}) {
  const base = useId();
  // Only the cities the person has toggled are stored; the rest follow the alert rule (an alert city opens itself).
  const [toggled, setToggled] = useState<Readonly<Record<number, boolean>>>({});
  // Exclusive: the one open city, undefined until the person picks (then the first alert city is open), null when all are shut.
  const [only, setOnly] = useState<number | null | undefined>(undefined);
  // The city to open first: one with changes to review, else one with rain or snow.
  const firstAlert =
    rows.find((row) => (pending[row.stopIndex] ?? 0) > 0 && row.tiles.length > 0)?.stopIndex ??
    rows.find((row) => row.alert && row.tiles.length > 0)?.stopIndex ??
    null;
  return (
    <ul className={styles.cityList}>
      {rows.map((row) => {
        const waiting = pending[row.stopIndex] ?? 0;
        const open = exclusive
          ? (only === undefined ? firstAlert : only) === row.stopIndex
          : (toggled[row.stopIndex] ?? (row.alert || waiting > 0));
        const panel = `${base}-panel-${row.stopIndex}`;
        const heading = alertHeading(weatherLabel, row.condition);
        // "N to review" while changes wait for a decision, "Rain · N added" once they are in the bag (spec decision 5).
        // The review count is for any change waiting on this city (a dry, high-UV day suggests things too); the added-items
        // line stays for a rain or snow city whose changes are already in the bag.
        const state =
          waiting > 0
            ? `${waiting} to review`
            : row.alert
              ? `${heading} · ${weatherItems} added`
              : null;
        const text = (
          <span className={styles.cityText}>
            <strong>
              {row.city} · {row.range}
            </strong>{" "}
            <span>{row.summary}</span>
          </span>
        );
        return (
          <li
            key={row.stopIndex}
            className={styles.cityRow}
            data-alert={row.alert}
            data-weather-source={row.source}
          >
            {row.tiles.length === 0 ? (
              <div className={styles.cityStatic}>
                {text}
                {/* A typical-only stay has no days to open, but its changes still wait on a decision. */}
                {state ? <span className={styles.cityState}>{state}</span> : null}
              </div>
            ) : (
              <h3 className={styles.cityHead}>
                <button
                  type="button"
                  className={styles.cityButton}
                  aria-expanded={open}
                  aria-controls={panel}
                  onClick={() =>
                    exclusive
                      ? setOnly(open ? null : row.stopIndex)
                      : setToggled((now) => ({ ...now, [row.stopIndex]: !open }))
                  }
                >
                  {text}
                  <span className={styles.cityState}>
                    {state}
                    <Icon name={open ? "caretUp" : "caretDown"} size={16} />
                  </span>
                </button>
              </h3>
            )}
            {row.tiles.length > 0 && open ? (
              <div id={panel} role="region" aria-label={`${row.city} forecast`}>
                <ul className={styles.dayGrid}>
                  {row.tiles.map((tile) => (
                    <li key={tile.date}>
                      <WeatherDayTile
                        variant="compact"
                        day={tile.day}
                        date={tile.dayOfMonth}
                        high={tile.high}
                        low={tile.low}
                        precipProbability={tile.precipProbability}
                        alert={tile.rain}
                      />
                    </li>
                  ))}
                </ul>
                {row.more > 0 ? (
                  <p className={styles.more}>
                    <Link href={`/trips/${tripId}`}>+{row.more} more days</Link>
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The weather the Home shows for the next trip (#387, #388): a city row per stay (an alert city opens itself), or the
 * usual weather for a trip whose forecast has not opened, or one line saying why there is none. Null when there is
 * nothing to say yet.
 */
export function HomeWeather({
  trip,
  today,
  weather,
  model,
  empty = null,
  exclusive = false,
}: {
  /** The phone Home keeps one city open at a time. */
  exclusive?: boolean;
  trip: LifecycleTrip;
  today: string;
  weather: HeroWeather;
  /** Shown when there is nothing else to say (the phone panel is never blank). */
  empty?: ReactNode;
  model: Pick<HomeModel, "phase" | "stops" | "rows" | "weatherCube" | "weatherItems" | "pending">;
}) {
  const { phase, stops, rows, weatherCube, weatherItems, pending } = model;
  let block: ReactNode = null;
  if (weather.phase === "off") {
    block = <WeatherOffBlock />;
  } else if (phase === "far" && weather.phase === "ready") {
    block = <UsualWeatherBlock start={trip.start} today={today} rows={weather.usual ?? []} />;
  } else if (phase === "far" && weather.phase === "unavailable") {
    block = (
      <UsualWeatherBlock start={trip.start} today={today} rows={usualRows(stops, [], "F", today)} />
    );
  } else if (weather.phase === "ready" && rows.length > 0) {
    block = (
      <div className={styles.packFor}>
        <h2 className={styles.eyebrow}>Pack for · tap a place for daily</h2>
        <CityRows
          rows={rows}
          weatherLabel={weatherCube?.name ?? null}
          weatherItems={weatherItems}
          pending={pending}
          tripId={trip.id}
          exclusive={exclusive}
        />
      </div>
    );
  } else if (weather.phase === "unavailable") {
    block = <p className={styles.weatherNote}>Weather is unavailable right now.</p>;
  }

  return block ?? empty;
}
