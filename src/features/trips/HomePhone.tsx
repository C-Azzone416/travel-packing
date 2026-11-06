"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { Icon } from "@/components/ui/Icon";
import {
  CountdownBadge,
  CubeTile,
  LuggageTag,
  Pill,
  PillTabs,
  Suitcase,
  WeatherDayTile,
} from "@/components/suitcase";
import { itemCube } from "@/domain/cubes";
import { tripPhase, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { tripDisplayName } from "@/domain/trip-route";
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
  pendingByStop,
  suitcaseButtonLabel,
  upcomingRow,
  type CityWeather,
} from "./home-view";
import {
  homeStampFilterLabel,
  homeStampsView,
  homeTab,
  phoneTagDates,
  type HomeStampFilter,
  type HomeStickerView,
  type HomeTab,
} from "./home-phone-view";
import styles from "./HomePhone.module.css";

export interface HomePhoneProps {
  trip: LifecycleTrip;
  trips: readonly LifecycleTrip[];
  later: readonly LifecycleTrip[];
  today: string;
  weather: HeroWeather;
  map: ReactNode;
  busy: boolean;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenArchive: () => void;
}

function replaceTab(tab: HomeTab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.pushState(window.history.state, "", url);
}

function CityRows({
  rows,
  weatherLabel,
  weatherItems,
  pending,
  tripId,
}: {
  rows: readonly CityWeather[];
  weatherLabel: string | null;
  weatherItems: number;
  pending: Readonly<Record<number, number>>;
  tripId: string;
}) {
  const base = useId();
  const [toggled, setToggled] = useState<Readonly<Record<number, boolean>>>({});
  return (
    <ul className={styles.cityList}>
      {rows.map((row) => {
        const open = toggled[row.stopIndex] ?? row.alert;
        const panel = `${base}-forecast-${row.stopIndex}`;
        const waiting = pending[row.stopIndex] ?? 0;
        const heading = alertHeading(weatherLabel, row.condition);
        const state = row.alert
          ? waiting > 0
            ? `${waiting} to review`
            : `${heading} · ${weatherItems} added`
          : null;
        return (
          <li key={row.stopIndex} className={styles.cityRow} data-alert={row.alert || undefined}>
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => setToggled((current) => ({ ...current, [row.stopIndex]: !open }))}
              >
                <span className={styles.cityCopy}>
                  <strong>
                    {row.city} · {row.range}
                  </strong>{" "}
                  <span>{row.summary}</span>
                </span>
                <span className={styles.cityState}>
                  {state}
                  <Icon name={open ? "caretUp" : "caretDown"} size={16} />
                </span>
              </button>
            </h3>
            {open && row.tiles.length > 0 ? (
              <div id={panel} role="region" aria-label={`${row.city} forecast`}>
                <ul className={styles.days}>
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
                  <Link className={styles.moreDays} href={`/trips/${tripId}`}>
                    +{row.more} more days
                  </Link>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Sticker({ sticker }: { sticker: HomeStickerView }) {
  return (
    <Link
      href={`/trips/${sticker.tripId}`}
      className={styles.sticker}
      aria-label={sticker.accessibleName}
      data-upcoming={sticker.upcoming || undefined}
      data-shape={sticker.shape}
      data-colour={sticker.colour}
      style={{ "--tilt": `${sticker.tilt}deg` } as React.CSSProperties}
    >
      <span aria-hidden="true">{sticker.region}</span>
      <strong aria-hidden="true">{sticker.code || "—"}</strong>
      <span aria-hidden="true">{sticker.month}</span>
      {sticker.completedCount > 1 ? <b aria-hidden="true">×{sticker.completedCount}</b> : null}
    </Link>
  );
}

export function HomePhone({
  trip,
  trips,
  later,
  today,
  weather,
  map,
  busy,
  onEdit,
  onArchive,
  onRemove,
  onOpenArchive,
}: HomePhoneProps) {
  const [tab, setTab] = useState<HomeTab>(() =>
    typeof window === "undefined"
      ? "pack"
      : homeTab(new URLSearchParams(location.search).get("tab")),
  );
  const [stampFilter, setStampFilter] = useState<HomeStampFilter>("rolling");
  useEffect(() => {
    const onPop = () => setTab(homeTab(new URLSearchParams(location.search).get("tab")));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const name = tripDisplayName(trip);
  const hero = heroName(trip);
  const phase = tripPhase(trip, today);
  const nights = Math.max(0, daysBetween(trip.start, trip.end));
  const countdown = phase === "during" || phase === "past" ? null : countdownFor(trip, today);
  const rows = weather.phase === "ready" ? (weather.city ?? []) : [];
  const cities = alertCities(rows);
  const firstAlert = rows.find((row) => row.alert)?.stopIndex ?? 0;
  const pending = pendingByStop(
    trip,
    weather.phase === "ready" ? weather.review : undefined,
    firstAlert,
  );
  const alert = Object.values(pending).some((count) => count > 0);
  const cubes = cubeSummaries(trip, { cities });
  const totals = bagTotals(cubes);
  const weatherCube = cubes.find((cube) => cube.cube === "weather") ?? null;
  const weatherItems = trip.items
    .filter((item) => itemCube(item) === "weather")
    .reduce((sum, item) => sum + item.qty, 0);
  const next = firstOpenCube(cubes);
  const label = suitcaseButtonLabel(totals, trip.ready, phase);
  const stampView = useMemo(
    () => homeStampsView(trips, today, stampFilter),
    [trips, today, stampFilter],
  );

  function select(nextTab: HomeTab) {
    setTab(nextTab);
    replaceTab(nextTab);
  }

  const tabs = [
    { id: "pack", label: "Pack", sub: `${totals.packed}/${totals.total}` },
    {
      id: "weather",
      label: "Weather",
      sub: alert ? "ALERT" : "All clear",
      alert,
    },
    {
      id: "future",
      label: "Future",
      sub: `${later.length} ${later.length === 1 ? "trip" : "trips"}`,
    },
    { id: "stamps", label: "Stamps", sub: String(homeStampsView(trips, today, "rolling").inked) },
  ];

  return (
    <div className={styles.page} aria-busy={busy}>
      <h1 className="sr-only">Trips</h1>
      <LuggageTag className={styles.hero} role="region" aria-labelledby="home-phone-trip">
        <div className={styles.tagCopy}>
          <p>
            NEXT TRIP · {phoneTagDates(trip)} · {nights} {nights === 1 ? "NIGHT" : "NIGHTS"}
          </p>
          <h2 id="home-phone-trip" data-size={hero.size}>
            {hero.title}
            {hero.subtitle ? <span> {hero.subtitle}</span> : null}
          </h2>
        </div>
        <div className={styles.tagActions}>
          {countdown ? <CountdownBadge className={styles.countdown} days={countdown.days} /> : null}
          <MoreMenu
            subject={name}
            disabled={busy}
            items={[
              { key: "edit", label: "Edit trip", onSelect: () => onEdit(trip.id) },
              { key: "copy", label: "Copy trip", href: `/trips/new?copy=${trip.id}` },
              { key: "archive", label: "Archive", onSelect: () => onArchive(trip.id) },
              { key: "past", label: "Past trips & archive", onSelect: onOpenArchive },
              { key: "remove", label: "Remove", danger: true, onSelect: () => onRemove(trip.id) },
            ]}
          />
        </div>
      </LuggageTag>

      <PillTabs
        label="Home sections"
        items={tabs}
        value={tab}
        idBase="home-phone"
        onChange={(value) => select(homeTab(value))}
      />

      <section
        className={styles.panel}
        role="tabpanel"
        id={`home-phone-panel-${tab}`}
        aria-labelledby={`home-phone-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "pack" ? (
          <div className={styles.pack}>
            <div className={styles.mapCard}>
              {map ?? (
                <div className={styles.mapFallback} role="img" aria-label="Route map unavailable">
                  Map unavailable
                </div>
              )}
            </div>
            <Suitcase role="region" aria-label={`${totals.packed} of ${totals.total} in the bag`}>
              <div className={styles.bagHead}>
                <p>
                  <strong>{totals.packed}</strong>
                  <span> / {totals.total} in the bag</span>
                </p>
                <span>tap a cube</span>
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
              <Link className={styles.primary} href={packingHref(trip.id, next)}>
                {label}
              </Link>
            </Suitcase>
          </div>
        ) : null}

        {tab === "weather" ? (
          <div className={styles.weather}>
            <h2>Pack for · tap for daily</h2>
            {rows.length > 0 ? (
              <CityRows
                rows={rows}
                weatherLabel={weatherCube?.name ?? null}
                weatherItems={weatherItems}
                pending={pending}
                tripId={trip.id}
              />
            ) : (
              <p className={styles.emptyWeather}>
                {weather.phase === "off"
                  ? "Weather is off in Settings."
                  : weather.phase === "loading"
                    ? "Loading weather…"
                    : "Weather is unavailable right now."}
              </p>
            )}
          </div>
        ) : null}

        {tab === "future" ? (
          <div className={styles.future}>
            <div className={styles.panelHead}>
              <h2>Future trips</h2>
              <Link href="/trips/new">+ Plan a trip</Link>
            </div>
            {later.length > 0 ? (
              <ul>
                {later.map((other) => {
                  const row = upcomingRow(other, today);
                  return (
                    <li key={row.id}>
                      <Link href={`/trips/${row.id}`}>
                        <LuggageTag variant="mini">
                          <span className={styles.futureRow}>
                            <b>{row.date}</b>
                            <strong>{row.name}</strong>
                            <span>{row.route}</span>
                          </span>
                        </LuggageTag>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.noFuture}>No future trips yet.</p>
            )}
            <button type="button" className={styles.pastLink} onClick={() => select("stamps")}>
              Past trips are with your stamps ›
            </button>
          </div>
        ) : null}

        {tab === "stamps" ? (
          <div className={styles.stampsPanel}>
            <div className={styles.stampFilters} role="group" aria-label="Filter stamps">
              {(["rolling", "year", "all"] as const).map((filter) => (
                <Pill
                  key={filter}
                  size="stamps"
                  active={stampFilter === filter}
                  onClick={() => setStampFilter(filter)}
                >
                  {homeStampFilterLabel(filter, today)}
                </Pill>
              ))}
            </div>
            <Suitcase interior="dark" inset="stamps" className={styles.stampCase}>
              <div className={styles.stampHead}>
                <p>Stickers · {homeStampFilterLabel(stampFilter, today)}</p>
                <strong>{stampView.inked} inked</strong>
              </div>
              <div className={styles.stickerGrid} aria-label="Trip stickers">
                {stampView.stickers.map((sticker) => (
                  <Sticker key={sticker.key} sticker={sticker} />
                ))}
              </div>
              <dl className={styles.totals} aria-label="Travel totals">
                {[
                  [stampView.totals.trips, "trips"],
                  [stampView.totals.places, "places"],
                  [stampView.totals.countries, "countries"],
                  [stampView.totals.nights, "nights away"],
                ].map(([value, title]) => (
                  <div key={title}>
                    <dt>{title}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.stampNote}>
                Dashed stickers are trips you haven’t taken yet. They ink when you get home.
              </p>
            </Suitcase>
            <h2 className={styles.pastTitle}>Past trips</h2>
            <ul className={styles.pastTrips}>
              {stampView.past.map((past) => (
                <li key={past.id}>
                  <Link href={`/trips/${past.id}`}>
                    <span>
                      <strong>{past.name}</strong>
                      <small>{past.facts}</small>
                    </span>
                    <b>
                      {past.packed}/{past.total} packed ›
                    </b>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
