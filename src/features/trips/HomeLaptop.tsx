"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { itemCube } from "@/domain/cubes";
import { Icon } from "@/components/ui/Icon";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { UsualWeatherBlock, WeatherOffBlock } from "@/components/ui/UsualWeather";
import {
  CountdownBadge,
  CubeTile,
  LuggageTag,
  Suitcase,
  WeatherDayTile,
} from "@/components/suitcase";
import { tripPhase, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { routeCaption, stopsOrDestination, tripDisplayName, tripFacts } from "@/domain/trip-route";
import { daysBetween } from "@/domain/trip-stops";
import type { HeroWeather } from "./NextDeparture";
import {
  alertCities,
  alertHeading,
  bagTotals,
  countdownFor,
  cubeSummaries,
  firstOpenCube,
  heroName,
  packingHref,
  suitcaseButtonLabel,
  tagDates,
  upcomingRow,
  usualRows,
  type CityWeather,
} from "./home-view";
import styles from "./HomeLaptop.module.css";

export interface HomeLaptopProps {
  trip: LifecycleTrip;
  /** The trips after the next one, earliest first. */
  later: readonly LifecycleTrip[];
  today: string;
  weather: HeroWeather;
  /** The route map rendered on the server for this trip, or null when it has no placeable stops. */
  map: ReactNode;
  busy: boolean;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}

function CityRows({
  rows,
  weatherLabel,
  weatherItems,
  tripId,
}: {
  rows: readonly CityWeather[];
  weatherLabel: string | null;
  weatherItems: number;
  tripId: string;
}) {
  const base = useId();
  // Only the cities the person has toggled are stored; the rest follow the alert rule (an alert city opens itself).
  const [toggled, setToggled] = useState<Readonly<Record<number, boolean>>>({});
  return (
    <ul className={styles.cityList}>
      {rows.map((row) => {
        const open = toggled[row.stopIndex] ?? row.alert;
        const panel = `${base}-panel-${row.stopIndex}`;
        const heading = alertHeading(weatherLabel, row.condition);
        const state = row.alert
          ? weatherItems > 0
            ? `${heading} · ${weatherItems} added`
            : `${heading} likely`
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
              <div className={styles.cityStatic}>{text}</div>
            ) : (
              <h3 className={styles.cityHead}>
                <button
                  type="button"
                  className={styles.cityButton}
                  aria-expanded={open}
                  aria-controls={panel}
                  onClick={() => setToggled((now) => ({ ...now, [row.stopIndex]: !open }))}
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
 * The laptop Home (>= 1024px) for the next trip (#387): the route map and the suitcase on the left, the luggage tag and
 * the upcoming trips on the right. The data, saves and authorisation stay with TripsDashboard; this only draws.
 */
export function HomeLaptop({
  trip,
  later,
  today,
  weather,
  map,
  busy,
  onEdit,
  onArchive,
  onRemove,
}: HomeLaptopProps) {
  const name = tripDisplayName(trip);
  const stops = stopsOrDestination(trip);
  const phase = tripPhase(trip, today);
  const nights = Math.max(0, daysBetween(trip.start, trip.end));
  const hero = heroName(trip);
  const countdown = phase === "during" || phase === "past" ? null : countdownFor(trip, today);

  const rows = weather.phase === "ready" ? (weather.city ?? []) : [];
  const cities = alertCities(rows);
  const cubes = cubeSummaries(trip, { cities });
  const totals = bagTotals(cubes);
  const weatherCube = cubes.find((cube) => cube.cube === "weather") ?? null;
  const weatherItems = trip.items.filter((item) => itemCube(item) === "weather").length;
  const label = suitcaseButtonLabel(totals, trip.ready, phase);
  const next = firstOpenCube(cubes);
  const caption = routeCaption({
    origin: trip.origin,
    travelMode: trip.travelMode,
    nights,
    stops,
  });

  let weatherBlock: ReactNode = null;
  if (weather.phase === "off") {
    weatherBlock = <WeatherOffBlock />;
  } else if (phase === "far" && weather.phase === "ready") {
    weatherBlock = (
      <UsualWeatherBlock start={trip.start} today={today} rows={weather.usual ?? []} />
    );
  } else if (phase === "far" && weather.phase === "unavailable") {
    weatherBlock = (
      <UsualWeatherBlock start={trip.start} today={today} rows={usualRows(stops, [], "F", today)} />
    );
  } else if (weather.phase === "ready" && rows.length > 0) {
    weatherBlock = (
      <div className={styles.packFor}>
        <h2 className={styles.eyebrow}>Pack for · tap a place for daily</h2>
        <CityRows
          rows={rows}
          weatherLabel={weatherCube?.name ?? null}
          weatherItems={weatherItems}
          tripId={trip.id}
        />
      </div>
    );
  } else if (weather.phase === "unavailable") {
    weatherBlock = <p className={styles.weatherNote}>Weather is unavailable right now.</p>;
  }

  return (
    <div className={styles.page} aria-busy={busy}>
      <h1 className="sr-only">Trips</h1>
      <div className={styles.grid}>
        <div className={styles.left}>
          <figure className={styles.mapCard}>
            {map ?? (
              <div className={styles.mapFallback} role="img" aria-label="Route map unavailable">
                Map unavailable
              </div>
            )}
            <figcaption className={styles.caption}>{caption}</figcaption>
          </figure>

          <Suitcase role="region" aria-labelledby="home-bag-title">
            <div className={styles.bagHead}>
              <div>
                <h2 id="home-bag-title" className={styles.eyebrow}>
                  In the bag · tap a cube
                </h2>
                <p className={styles.bigCount}>
                  <span>{totals.packed}</span>
                  <span className={styles.bigOf}>of {totals.total}</span>
                </p>
              </div>
              <Link
                className={styles.primary}
                href={packingHref(trip.id, next)}
                aria-label={`${label}: ${name}`}
              >
                {label}
              </Link>
            </div>
            <ul className={styles.cubes} aria-label="Cubes">
              {cubes.map((cube) => (
                <li key={cube.cube}>
                  <CubeTile
                    name={cube.name}
                    packed={cube.packed}
                    total={cube.total}
                    note={cube.note}
                    morningOf={cube.morningOf}
                    alert={cube.alert}
                    href={packingHref(trip.id, cube.cube)}
                  />
                </li>
              ))}
            </ul>
          </Suitcase>
        </div>

        <div className={styles.right}>
          <LuggageTag role="region" aria-labelledby="home-trip-title">
            <div className={styles.tagTop}>
              <p className={styles.chip}>
                NEXT TRIP · <span className={styles.chipDate}>{tagDates(trip, today)}</span>
              </p>
              <MoreMenu
                subject={name}
                disabled={busy}
                items={[
                  { key: "edit", label: "Edit trip", onSelect: () => onEdit(trip.id) },
                  { key: "copy", label: "Copy trip", href: `/trips/new?copy=${trip.id}` },
                  { key: "archive", label: "Archive", onSelect: () => onArchive(trip.id) },
                  { key: "past", label: "Past trips & archive", href: "/?view=archive" },
                  {
                    key: "remove",
                    label: "Remove",
                    danger: true,
                    onSelect: () => onRemove(trip.id),
                  },
                ]}
              />
            </div>
            <h2 id="home-trip-title" className={styles.name} data-size={hero.size}>
              {hero.title}
              {hero.subtitle ? <span className="sr-only"> {hero.subtitle}</span> : null}
            </h2>
            {hero.subtitle ? (
              <p className={styles.sub} aria-hidden="true">
                {hero.subtitle}
              </p>
            ) : null}
            <div className={styles.facts}>
              {countdown ? (
                <>
                  <CountdownBadge days={countdown.days} toGo />
                  <span className="sr-only">{countdown.spoken}</span>
                </>
              ) : null}
              <p className={styles.factsText}>
                {tripFacts({ travelMode: trip.travelMode, nights, stops })}
              </p>
            </div>
            {weatherBlock}
          </LuggageTag>

          <section aria-labelledby="home-upcoming-title">
            <div className={styles.upHead}>
              <h2 id="home-upcoming-title" className={styles.upTitle}>
                Upcoming trips
              </h2>
              <Link className={styles.link} href="/stamps">
                Past &amp; archive
              </Link>
              <Link className={`${styles.link} ${styles.plan}`} href="/trips/new">
                <Icon name="plus" size={16} />
                Plan a trip
              </Link>
            </div>
            {later.length > 0 ? (
              <ul className={styles.upList}>
                {later.map((other) => {
                  const row = upcomingRow(other, today);
                  return (
                    <li key={row.id}>
                      <Link className={styles.miniLink} href={`/trips/${row.id}`}>
                        <LuggageTag variant="mini">
                          <span className={styles.miniRow}>
                            <span className={styles.miniDate}>{row.date}</span>
                            <span className={styles.miniName}>{row.name}</span>
                            <span className={styles.miniRoute}>{row.route}</span>
                          </span>
                        </LuggageTag>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
