"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CountdownBadge, LuggageTag, Suitcase } from "@/components/suitcase";
import { Icon } from "@/components/ui/Icon";
import type { RoutePoint, TravelMode } from "@/domain/route-map/geometry";
import type { TripDraft } from "@/domain/trip-lifecycle";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import {
  aboutItems,
  formatPlanRange,
  placesOf,
  tagTitle,
  tripLength,
  type PlanPreview as Preview,
  type PlanWeatherRow,
} from "./plan-model";
import type { RouteMapActionInput } from "./route-map-action";
import styles from "./plan.module.css";

/** Draws the route for these points on the server; null when it cannot (the preview then shows no map). */
export type RenderMap = (input: RouteMapActionInput) => Promise<ReactNode | null>;

function point(location: SampleLocation, kind: RoutePoint["kind"]): RoutePoint | null {
  if (location.latitude === undefined || location.longitude === undefined) return null;
  return { lat: location.latitude, lng: location.longitude, label: location.city, kind };
}

/** The route as map points: the origin first (the home pin), then every stop that has coordinates. */
export function mapPoints(draft: TripDraft): RoutePoint[] {
  const home = draft.origin ? point(draft.origin, "home") : null;
  const stops = placesOf(draft)
    .map((place) => point(place, "stop"))
    .filter((entry): entry is RoutePoint => entry !== null);
  return home ? [home, ...stops] : stops;
}

/** How many more times a map that did not come back is asked for, and how long to wait between asks. */
export const MAP_RETRIES = 2;
const RETRY_MS = 600;

function PreviewMap({
  points,
  mode,
  size,
  render,
}: {
  points: RoutePoint[];
  mode: TravelMode;
  size: "laptop" | "phone";
  render: RenderMap;
}) {
  const key = JSON.stringify({ points, mode, size });
  const [drawn, setDrawn] = useState<{ key: string; node: ReactNode } | null>(null);
  useEffect(() => {
    if (points.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A short pause, so typing in a date or reordering does not ask the server for every keystroke. A draw that comes back empty
    // or fails (a busy server, a dropped request) is tried again a couple of times rather than leaving a blank box.
    const attempt = (left: number, wait: number) => {
      timer = setTimeout(() => {
        render({ points, mode, size }).then(
          (node) => {
            if (cancelled) return;
            if (node) setDrawn({ key, node });
            else if (left > 0) attempt(left - 1, RETRY_MS);
          },
          () => {
            if (!cancelled && left > 0) attempt(left - 1, RETRY_MS);
          },
        );
      }, wait);
    };
    attempt(MAP_RETRIES, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` stands for points, mode and size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, render]);
  if (points.length === 0) return null;
  // Keep the last drawn map while the next one is on its way (it is replaced, never blanked).
  return (
    <div
      className={styles.map}
      data-plan-map=""
      data-map-ready={drawn?.key === key ? "" : undefined}
    >
      {drawn?.node ?? <div className={styles.mapEmpty} aria-hidden="true" />}
    </div>
  );
}

export interface PlanPreviewProps {
  variant: "laptop" | "phone";
  draft: TripDraft;
  /** Null until Where and When are finished (the count needs both). */
  preview: Preview | null;
  weatherRows: readonly PlanWeatherRow[];
  /** "2 weather items suggested. You’ll review them while packing." (or the added wording); empty hides it. */
  weatherNote: string;
  renderMap: RenderMap;
}

function WeatherIcon({ row }: { row: PlanWeatherRow }) {
  return (
    <Icon name={row.glyph === "sun" ? "sun" : "rain"} size={22} className={styles.weatherIcon} />
  );
}

// The live preview (spec #376 section 1.7): the luggage tag, the route map inside it, the mini suitcase with the count and
// the cubes, and the weather under it. Laptop: a sticky column beside the steps. Phone: only the Review step shows it, as
// the tag, the map and the suitcase summary stacked (no weather).
export function PlanPreview({
  variant,
  draft,
  preview,
  weatherRows,
  weatherNote,
  renderMap,
}: PlanPreviewProps) {
  const { title, also } = tagTitle(draft);
  const range = formatPlanRange(draft.start, draft.end);
  const days = tripLength(draft);
  const points = useMemo(() => mapPoints(draft), [draft]);
  const mode: TravelMode = draft.travelMode ?? "fly";
  const laptop = variant === "laptop";
  const forecastRows = weatherRows.some((row) => row.forecast);
  return (
    <aside
      className={laptop ? styles.preview : styles.previewPhone}
      aria-label="Live preview of your trip"
    >
      {laptop ? <p className={styles.eyebrow}>Live preview</p> : null}
      <LuggageTag className={styles.previewTag}>
        <p className={styles.tagEyebrow}>{`NEW TRIP${range ? ` · ${range}` : ""}`}</p>
        <div className={styles.tagHead}>
          <div className={styles.tagNames}>
            <p className={styles.tagTitle}>{title || "Where to?"}</p>
            {also ? <p className={styles.tagAlso}>{also}</p> : null}
          </div>
          {days > 0 ? <CountdownBadge days={days} className={styles.tagBadge} /> : null}
        </div>
        <PreviewMap points={points} mode={mode} size={variant} render={renderMap} />
      </LuggageTag>
      <Suitcase interior="paper" className={styles.miniCase}>
        <p className={styles.miniTitle} role="status">
          {preview ? aboutItems(preview.total) : "Add dates to see your list"}
        </p>
        {preview ? (
          <ul className={styles.cubeChips} aria-label="Cubes">
            {preview.cubes.map((cube) => (
              <li key={cube.cube} className={styles.cubeChip}>
                {cube.label}
              </li>
            ))}
          </ul>
        ) : null}
      </Suitcase>
      {laptop && weatherRows.length > 0 ? (
        <section className={styles.weather} aria-labelledby="plan-weather-title">
          <h2 id="plan-weather-title" className={styles.eyebrow}>
            {forecastRows ? "Weather · forecast" : "Weather · usual"}
          </h2>
          <ul className={styles.weatherList}>
            {weatherRows.map((row) => (
              <li
                key={row.id}
                className={styles.weatherRow}
                data-alert={row.alert ? "" : undefined}
              >
                <WeatherIcon row={row} />
                <span className={styles.weatherText}>
                  <span className={styles.weatherCity}>
                    {row.city} <span className={styles.weatherDates}>{row.dates}</span>
                  </span>
                  <span className={styles.weatherLine}>{row.line}</span>
                </span>
                <span className={styles.weatherRange}>{row.range}</span>
              </li>
            ))}
          </ul>
          {weatherNote ? <p className={styles.weatherNote}>{weatherNote}</p> : null}
        </section>
      ) : null}
    </aside>
  );
}
