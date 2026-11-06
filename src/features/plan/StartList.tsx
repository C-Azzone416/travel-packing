"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { SavedListSummary } from "@/server/data/service";
import { nightsText } from "@/domain/trip-route";
import { sortedLine, type PlanPreview, type WeatherAdds } from "./plan-model";
import type { PlanWeather } from "./use-plan-weather";
import styles from "./plan.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Portland · Jul 2026 · 22 items": a past trip in one line. */
export function pastTripLine(trip: Pick<LifecycleTrip, "destination" | "start" | "items">): string {
  const [year, month] = trip.start.split("-");
  const when = MONTHS[Number(month) - 1];
  const count = trip.items.reduce((sum, item) => sum + item.qty, 0);
  return [
    trip.destination,
    when ? `${when} ${year}` : "",
    `${count} ${count === 1 ? "item" : "items"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "+2", "+22", "0" or "−3": what a choice does to the count. */
export function deltaLabel(delta: number): string {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

interface OptionProps {
  title: ReactNode;
  sub: ReactNode;
  count?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  /** Buttons and choosers that belong to the card but are not part of its checkbox label. */
  children?: ReactNode;
  /** The tail of the title, muted ("always"). */
  tail?: string;
}

// An option card (spec part 2 section 9): a real checkbox inside a label, so the whole card is the hit area; the title and
// the sub-line are its name and description.
function Option({ title, sub, count, checked, disabled, onChange, children, tail }: OptionProps) {
  const id = useId();
  return (
    <div className={styles.option} data-checked={checked ? "" : undefined}>
      <label className={styles.optionLabel} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className={styles.optionInput}
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-sub`}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span className={styles.optionBox} aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
        <span className={styles.optionText}>
          <span className={styles.optionTitle}>
            {title}
            {tail ? <span className={styles.optionTail}>{` · ${tail}`}</span> : null}
          </span>
          <span id={`${id}-sub`} className={styles.optionSub}>
            {sub}
          </span>
        </span>
        {count ? <span className={styles.optionCount}>{count}</span> : null}
      </label>
      {children}
    </div>
  );
}

export interface StartListProps {
  nights: number | null;
  /** Items the Staples alone start the trip with. */
  staplesTotal: number | null;
  laundry: boolean;
  onLaundry: (on: boolean) => void;
  laundryText: string;
  weather: PlanWeather;
  weatherAdds: WeatherAdds | null;
  useWeather: boolean;
  onUseWeather: (on: boolean) => void;
  onWeatherOptIn: (on: boolean) => void;
  onWeatherRefresh: () => void;
  pastTrips: readonly LifecycleTrip[];
  copyId: string | null;
  /** Items the chosen past trip's preferences add or remove against the Staples alone, or null with no choice. */
  copyDelta: number | null;
  onCopy: (id: string | null) => void;
  lists: readonly SavedListSummary[];
  listId: string | null;
  listTotal: number | null;
  listBusy: boolean;
  listError: boolean;
  onList: (id: string | null) => void;
  preview: PlanPreview | null;
}

const PAST_CHOICES = 5;

function TripChooser({
  trips,
  value,
  onChange,
}: {
  trips: readonly LifecycleTrip[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const name = useId();
  const wanted = query.trim().toLowerCase();
  const found = wanted
    ? trips.filter((trip) => trip.destination.toLowerCase().includes(wanted))
    : trips.slice(0, PAST_CHOICES);
  // The chosen trip stays in the list even when the search hides it, so the choice is never invisible.
  const chosen = trips.find((trip) => trip.id === value);
  const shown = chosen && !found.includes(chosen) ? [chosen, ...found] : found;
  return (
    <fieldset className={styles.chooser}>
      <legend className="sr-only">Choose a past trip</legend>
      {trips.length > PAST_CHOICES ? (
        <>
          <label className={styles.eyebrow} htmlFor={searchId}>
            Search past trips
          </label>
          <input
            id={searchId}
            className={styles.chooserSearch}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </>
      ) : null}
      <ul className={styles.chooserList}>
        {shown.map((trip) => (
          <li key={trip.id}>
            <label className={styles.chooserRow}>
              <input
                type="radio"
                name={name}
                checked={trip.id === value}
                onChange={() => onChange(trip.id)}
              />
              <span>{pastTripLine(trip)}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Step 4 (spec section 1.7, pl-l-4): the Staples are always in; weather, a past trip or a saved list add to or replace them; laundry. */
export function StartList({
  nights,
  staplesTotal,
  laundry,
  onLaundry,
  laundryText,
  weather,
  weatherAdds,
  useWeather,
  onUseWeather,
  onWeatherOptIn,
  onWeatherRefresh,
  pastTrips,
  copyId,
  copyDelta,
  onCopy,
  lists,
  listId,
  listTotal,
  listBusy,
  listError,
  onList,
  preview,
}: StartListProps) {
  const replaced = listId !== null;
  const stapleSub = replaced
    ? "Your saved list stands in for them on this trip"
    : nights === null
      ? "Underwear, socks and other per-day items counted for your trip"
      : `Underwear, socks and other per-day items counted for ${nightsText(nights)}`;
  const latest = pastTrips[0];
  const chosenTrip = pastTrips.find((trip) => trip.id === copyId) ?? null;

  let weatherCard: ReactNode = null;
  if (weather.kind !== "hidden" && !replaced) {
    const ready = weather.kind === "ready";
    const sub =
      weather.kind === "prompt"
        ? "Only map coordinates and dates are sent to Open-Meteo. We never send your trip name, your places’ names, or who you are. You can change this any time in Settings."
        : weather.kind === "off"
          ? "Weather is off."
          : weather.kind === "loading"
            ? "Loading weather…"
            : weather.kind === "offline"
              ? "You’re offline. Your list still uses the standard packing calculation."
              : weather.kind === "unavailable"
                ? "Weather isn’t available. Your list still uses the standard packing calculation."
                : (weatherAdds?.line ?? "");
    weatherCard = (
      <Option
        title="Weather suggestions"
        sub={sub}
        count={ready && weatherAdds ? deltaLabel(weatherAdds.added) : undefined}
        checked={ready && useWeather}
        disabled={!ready}
        onChange={onUseWeather}
      >
        {weather.kind === "prompt" ? (
          <div className={styles.optionActions}>
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => onWeatherOptIn(true)}
            >
              Get weather
            </button>
            <button
              type="button"
              className={styles.smallGhost}
              onClick={() => onWeatherOptIn(false)}
            >
              Not now
            </button>
          </div>
        ) : null}
        {weather.kind === "off" ? (
          <div className={styles.optionActions}>
            <button
              type="button"
              className={styles.smallGhost}
              onClick={() => onWeatherOptIn(true)}
            >
              Turn on
            </button>
          </div>
        ) : null}
        {weather.kind === "offline" || weather.kind === "unavailable" ? (
          <div className={styles.optionActions}>
            <button type="button" className={styles.smallGhost} onClick={onWeatherRefresh}>
              Try again
            </button>
          </div>
        ) : null}
      </Option>
    );
  }

  const line = preview ? sortedLine(preview) : null;
  return (
    <div className={styles.startList}>
      <Option
        title="Your Staples"
        tail="always"
        sub={stapleSub}
        count={replaced || staplesTotal === null ? undefined : String(staplesTotal)}
        checked
        disabled
      />
      <p className={styles.eyebrow}>Add on top</p>
      {weatherCard}
      {latest && !replaced ? (
        <Option
          title="Copy a past trip"
          sub={chosenTrip ? pastTripLine(chosenTrip) : pastTripLine(latest)}
          count={copyDelta === null ? undefined : deltaLabel(copyDelta)}
          checked={copyId !== null}
          onChange={(on) => onCopy(on ? (copyId ?? latest.id) : null)}
        >
          {copyId !== null ? (
            <TripChooser trips={pastTrips} value={copyId} onChange={onCopy} />
          ) : null}
        </Option>
      ) : null}
      {lists.length > 0 && copyId === null ? (
        <Option
          title="Start from a saved list"
          sub={
            listError
              ? "That list couldn’t be loaded. Try again."
              : listBusy
                ? "Loading your list…"
                : "Use one of your saved lists instead of the Staples."
          }
          count={listTotal === null ? undefined : String(listTotal)}
          checked={listId !== null}
          onChange={(on) => onList(on ? lists[0].id : null)}
        >
          {listId !== null ? (
            <fieldset className={styles.chooser}>
              <legend className="sr-only">Choose a saved list</legend>
              <ul className={styles.chooserList}>
                {lists.map((list) => (
                  <li key={list.id}>
                    <label className={styles.chooserRow}>
                      <input
                        type="radio"
                        name="saved-list"
                        checked={list.id === listId}
                        onChange={() => onList(list.id)}
                      />
                      <span>{`${list.name} · ${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
        </Option>
      ) : null}
      <p className={styles.eyebrow}>On this trip</p>
      <Option
        title={
          <>
            <Icon name="refresh" size={18} className={styles.inlineIcon} />
            {" I’ll have laundry"}
          </>
        }
        sub={laundryText}
        checked={laundry}
        onChange={onLaundry}
      />
      {line ? (
        <p className={styles.sortedLine}>
          <strong>{line.bold}</strong>
          {line.rest}
        </p>
      ) : null}
    </div>
  );
}
