"use client";

import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { Icon } from "@/components/ui/Icon";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { CountdownBadge, CubeTile, DayBadge, LuggageTag, Suitcase } from "@/components/suitcase";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { tripFacts } from "@/domain/trip-route";
import { homeModel, packingHref, tagDates, type HeroWeather } from "./home-view";
import { HomeUpcoming } from "./HomeUpcoming";
import { HomeWeather } from "./HomeWeather";
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
  /** Opens the Past & archive list (the client does not remount on a same-page link, so this is a handler, not a href). */
  onOpenArchive: () => void;
  /** The page heading, which takes focus after a write (the control used may be gone). */
  headingRef?: Ref<HTMLHeadingElement>;
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
  onOpenArchive,
  headingRef,
}: HomeLaptopProps) {
  const model = homeModel(trip, weather, today);
  const {
    name,
    stops,
    nights,
    hero,
    countdown,
    dayBadge,
    chip,
    totals,
    cubes,
    label,
    next,
    caption,
  } = model;

  return (
    <div className={styles.page} aria-busy={busy}>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Trips
      </h1>
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
              <p className={styles.chip} data-on-now={dayBadge ? "" : undefined}>
                {chip} · <span className={styles.chipDate}>{tagDates(trip, today)}</span>
              </p>
              <MoreMenu
                subject={name}
                disabled={busy}
                items={[
                  { key: "edit", label: "Edit trip", onSelect: () => onEdit(trip.id) },
                  { key: "copy", label: "Copy trip", href: `/trips/new?copy=${trip.id}` },
                  { key: "archive", label: "Archive", onSelect: () => onArchive(trip.id) },
                  { key: "past", label: "Past trips & archive", onSelect: onOpenArchive },
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
              {dayBadge ? (
                <DayBadge day={dayBadge.day} of={dayBadge.of} last={dayBadge.last} />
              ) : null}
              {countdown ? (
                <>
                  <CountdownBadge days={countdown.days} toGo dayTrip={countdown.dayTrip} />
                  <span className="sr-only">{countdown.spoken}</span>
                </>
              ) : null}
              <p className={styles.factsText}>
                {tripFacts({ travelMode: trip.travelMode, nights, stops })}
              </p>
            </div>
            <HomeWeather trip={trip} today={today} weather={weather} model={model} />
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
              <HomeUpcoming trips={later} today={today} actions={{ onEdit, onArchive, onRemove }} />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
