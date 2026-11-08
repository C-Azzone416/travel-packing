"use client";

import { nightsText } from "@/domain/trip-route";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import { Icon } from "@/components/ui/Icon";
import { MoreMenu } from "@/components/ui/MoreMenu";
import {
  CountdownBadge,
  CubeTile,
  LuggageTag,
  PackedRibbon,
  PillTabs,
  Suitcase,
} from "@/components/suitcase";
import type { LifecycleState, LifecycleTrip } from "@/domain/trip-lifecycle";
import { packedState, reviewHref } from "@/features/trip/packed-state";
import { StampsContent } from "@/features/stamps/StampsScreen";
import { stampsView } from "@/features/stamps/stamps-view";
import {
  homeModel,
  packingHref,
  tagDatesShort,
  tripCount,
  weatherPillSub,
  type HeroWeather,
} from "./home-view";
import { HomeUpcoming } from "./HomeUpcoming";
import { HomeWeather } from "./HomeWeather";
import styles from "./HomePhone.module.css";

export type HomePanel = "pack" | "weather" | "future" | "stamps";

const PANELS: readonly HomePanel[] = ["pack", "weather", "future", "stamps"];

/** The pill chosen in the address (`/?tab=weather`); Pack when there is none or it is not one of the four. */
function panelFromLocation(): HomePanel {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return PANELS.find((panel) => panel === tab) ?? "pack";
}

export interface HomePhoneProps {
  trip: LifecycleTrip;
  /** The trips after the next one, earliest first. */
  later: readonly LifecycleTrip[];
  /** Every trip, for the Stamps pill and its panel. */
  state: LifecycleState;
  today: string;
  weather: HeroWeather;
  /** The route map rendered on the server for this trip, or null when it has no placeable stops. */
  map: ReactNode;
  busy: boolean;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
  /** Opens the archive list (Recently deleted and restore live there; Stamps only shows what happened). */
  onOpenArchive: () => void;
  /** The page heading, which takes focus after a write (the control used may be gone). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The phone Home (< 1024px) for the next trip (#388, spec #376): the luggage tag with its countdown and four pills, Pack,
 * Weather, Future and Stamps, each with its own panel. It draws the same model as the laptop Home (homeModel), so a count
 * never differs between them. The data, saves and authorisation stay with TripsDashboard.
 */
export function HomePhone({
  trip,
  later,
  state,
  today,
  weather,
  map,
  busy,
  onEdit,
  onArchive,
  onRemove,
  onOpenArchive,
  headingRef,
}: HomePhoneProps) {
  // The chosen pill is in the address, so a link, a reload and Back all land on it. The Home draws only after its trips have
  // loaded in the browser, so reading the address in the initial state cannot disagree with the server's markup.
  const [panel, setPanelState] = useState<HomePanel>(panelFromLocation);
  const setPanel = useCallback((next: HomePanel) => {
    setPanelState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
  }, []);
  useEffect(() => {
    const onPop = () => setPanelState(panelFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const model = homeModel(trip, weather, today);
  const { name, nights, hero, countdown, totals, cubes, label, next, caption, pendingCities } =
    model;
  const stamps = useMemo(() => stampsView(state.trips, today, "rolling").inked, [state, today]);
  const weatherSub = weatherPillSub(weather, model);
  const packed = packedState(trip);
  const weatherEmpty = (
    <p className={styles.note}>
      {weather.phase === "loading"
        ? "Checking the weather…"
        : weather.phase === "none"
          ? "No weather for this trip."
          : "No weather to show for this trip yet."}
    </p>
  );

  return (
    <div className={styles.page} aria-busy={busy}>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Trips
      </h1>
      <div className={styles.tagWrap}>
        <LuggageTag role="region" aria-labelledby="home-trip-title" className={styles.tag}>
          <div className={styles.tagRow}>
            <div className={styles.tagCopy}>
              <p className={styles.chip}>
                {packed === "ready" ? "READY" : "NEXT TRIP"} · {tagDatesShort(trip, today)} ·{" "}
                {nightsText(nights)}
              </p>
              <h2 id="home-trip-title" className={styles.name} data-size={hero.size}>
                {hero.title}
                {hero.subtitle ? <span className="sr-only"> {hero.subtitle}</span> : null}
                {hero.subtitle ? (
                  <span className={styles.sub} aria-hidden="true">
                    {hero.subtitle}
                  </span>
                ) : null}
              </h2>
            </div>
            <div className={styles.tagSide}>
              {countdown ? (
                <>
                  <CountdownBadge days={countdown.days} />
                  <span className="sr-only">{countdown.spoken}</span>
                </>
              ) : null}
            </div>
          </div>
        </LuggageTag>
        {/* The menu sits over the tag, not in it: the tag clips what falls outside its shape. */}
        <div className={styles.menuSlot}>
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
      </div>

      <PillTabs
        label="Trip sections"
        idBase="home"
        className={styles.pills}
        value={panel}
        onChange={(id) => setPanel(id as HomePanel)}
        items={[
          {
            id: "pack",
            label: "Pack",
            sub:
              packed === "ready"
                ? "Ready"
                : packed === "packed"
                  ? "All in"
                  : `${totals.packed}/${totals.total}`,
          },
          { id: "weather", label: "Weather", sub: weatherSub.text, alert: weatherSub.alert },
          { id: "future", label: "Future", sub: tripCount(later.length) },
          { id: "stamps", label: "Stamps", sub: String(stamps) },
        ]}
      />
      {/* The ALERT arrives after the forecast loads, so it is announced here as well as named on the pill. */}
      <p className="sr-only" role="status">
        {pendingCities.length > 0
          ? `Weather alert: suggestions to review for ${pendingCities.join(", ")}.`
          : ""}
      </p>

      {panel === "pack" ? (
        <div
          role="tabpanel"
          id="home-panel-pack"
          aria-labelledby="home-tab-pack"
          className={styles.panel}
        >
          <figure className={styles.mapCard} aria-label={caption}>
            {map ?? (
              <div className={styles.mapFallback} role="img" aria-label="Route map unavailable">
                Map unavailable
              </div>
            )}
          </figure>
          <Suitcase
            role="region"
            aria-labelledby="home-bag-title"
            ribbon={<PackedRibbon state={packed} />}
          >
            <div className={styles.bagHead}>
              <h2 id="home-bag-title" className={styles.bigCount}>
                <span className={styles.packed}>{totals.packed}</span>
                <span className={styles.bigOf}> / {totals.total} in the bag</span>
              </h2>
              <p className={styles.hint}>tap a cube</p>
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
            <Link
              className={styles.primary}
              href={packed === "packed" ? reviewHref(trip.id) : packingHref(trip.id, next)}
              aria-label={`${packed === "packed" ? "Review your bag" : label}: ${name}`}
            >
              {packed === "packed" ? "Review your bag" : label}
            </Link>
          </Suitcase>
        </div>
      ) : null}

      {panel === "weather" ? (
        <div
          role="tabpanel"
          id="home-panel-weather"
          aria-labelledby="home-tab-weather"
          className={styles.panel}
        >
          <HomeWeather
            trip={trip}
            today={today}
            weather={weather}
            model={model}
            empty={weatherEmpty}
            exclusive
          />
        </div>
      ) : null}

      {panel === "future" ? (
        <div
          role="tabpanel"
          id="home-panel-future"
          aria-labelledby="home-tab-future"
          className={styles.panel}
        >
          <div className={styles.futureHead}>
            <h2 className={styles.futureTitle}>Future trips</h2>
            <Link className={styles.plan} href="/trips/new">
              <Icon name="plus" size={16} />
              Plan a trip
            </Link>
          </div>
          {later.length > 0 ? (
            <HomeUpcoming
              trips={later}
              today={today}
              label="Future trips"
              actions={{ onEdit, onArchive, onRemove }}
            />
          ) : (
            <p className={styles.note}>No other trips planned yet.</p>
          )}
          <Link
            className={styles.pastLink}
            href="/?tab=stamps"
            onClick={(event) => {
              // Home's own Stamps panel; the Stamps screen stays one tap away in the navigation.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setPanel("stamps");
            }}
          >
            Past trips are with your stamps ›
          </Link>
        </div>
      ) : null}

      {panel === "stamps" ? (
        <div
          role="tabpanel"
          id="home-panel-stamps"
          aria-labelledby="home-tab-stamps"
          className={styles.panel}
        >
          <StampsContent state={state} today={today} embedded />
        </div>
      ) : null}
    </div>
  );
}
