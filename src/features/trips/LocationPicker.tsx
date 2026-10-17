"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LocationProvider } from "@/domain/location-provider";
import { customLocation } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";

// Whether a "Use “text” as typed" row is offered when nothing matches (#32). OFF until Caroline
// approves it; flipping this one constant turns the row on (the rest of the flow already handles it).
export const ALLOW_CUSTOM_DESTINATION = false;

export const UNAVAILABLE_MESSAGE = "Location search is unavailable right now. Try again.";

export interface LocationPickerProps {
  provider: LocationProvider;
  query: string;
  onQueryChange: (text: string) => void;
  selected: SampleLocation | null;
  onSelect: (location: SampleLocation) => void;
  onClear: () => void;
  allowCustom?: boolean;
}

// What the provider last answered, for one query and one attempt. Everything else (searching,
// too short, nothing yet) is derived, so a stale answer can never be shown for newer text.
type Answer =
  { key: string; status: "ready"; items: SampleLocation[] } | { key: string; status: "error" };

// An ARIA combobox over a LocationProvider. Free text alone never confirms a location: the user
// must pick an option (or the explicit Custom row when enabled).
export function LocationPicker({
  provider,
  query,
  onQueryChange,
  selected,
  onSelect,
  onClear,
  allowCustom = ALLOW_CUSTOM_DESTINATION,
}: LocationPickerProps) {
  const inputId = useId();
  const listId = useId();
  const noteId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const text = query.trim();
  const searchable = !selected && text.length >= provider.minQueryLength;
  const key = `${text}#${attempt}`;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      provider
        .search(text, { signal: controller.signal })
        .then((items) => {
          if (!controller.signal.aborted) setAnswer({ key, status: "ready", items });
        })
        .catch(() => {
          if (!controller.signal.aborted) setAnswer({ key, status: "error" });
        });
    }, provider.debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [provider, searchable, text, key]);

  const current = searchable && answer?.key === key ? answer : null;
  const searching = searchable && current === null;
  const failed = current?.status === "error";
  const matches = current?.status === "ready" ? current.items : [];
  const options: SampleLocation[] =
    allowCustom && current?.status === "ready" && matches.length === 0
      ? [customLocation(text)]
      : matches;
  const showList = open && options.length > 0;
  const noMatches = current?.status === "ready" && matches.length === 0 && options.length === 0;
  const optionId = (index: number) => `${listId}-${index}`;

  function choose(location: SampleLocation) {
    setActive(-1);
    onSelect(location);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (selected) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((value) => (value + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      // Never submit the form from the search box; Enter only picks the highlighted option.
      event.preventDefault();
      if (showList && active >= 0) choose(options[active]);
    } else if (event.key === "Escape" && showList) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const announcement = failed
    ? UNAVAILABLE_MESSAGE
    : searching
      ? "Searching"
      : noMatches
        ? "No matches"
        : current?.status === "ready" && matches.length > 0
          ? `${matches.length} ${matches.length === 1 ? "destination" : "destinations"} found`
          : "";

  return (
    <div className="location-picker">
      <label className="field" htmlFor={inputId}>
        Destination search
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name="destination"
        role="combobox"
        value={query}
        maxLength={50}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        aria-invalid={!selected}
        aria-describedby={noteId}
        onChange={(event) => {
          // Editing the text after confirming clears the confirmation.
          if (selected) onClear();
          setOpen(true);
          setActive(-1);
          onQueryChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={noteId} className="tiny muted">
        Choose the city, region and country you mean. Free text alone is never a confirmed location.
      </div>
      <p className="sr-only" role="status" aria-label="Destination results">
        {announcement}
      </p>
      {searching ? (
        <p className="tiny muted" aria-hidden="true">
          Searching…
        </p>
      ) : null}
      <div
        id={listId}
        role="listbox"
        aria-label="Matching destinations"
        className="location-results"
        hidden={!showList}
      >
        {options.map((option, index) => (
          <div
            key={option.id + option.label}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={index === active ? "location-option active" : "location-option"}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(option);
            }}
          >
            {option.id === "custom" ? (
              <>
                <strong>Use “{option.label}” as typed</strong>
                <small>Custom</small>
              </>
            ) : (
              <>
                <strong>{option.city}</strong>
                <span>
                  {option.region}, {option.country}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {noMatches ? <div className="empty-state compact">No matches. Try a city name.</div> : null}
      {failed ? (
        <div className="empty-state compact" role="alert">
          {UNAVAILABLE_MESSAGE}{" "}
          <button
            type="button"
            className="button secondary small"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
      {selected ? (
        <div className="confirmed-location" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Destination confirmed</strong>
            <small>
              {selected.id === "custom"
                ? `${selected.city} · Custom`
                : `${selected.city} · ${selected.region} · ${selected.country}`}
            </small>
          </div>
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
          >
            Change
          </button>
        </div>
      ) : null}
    </div>
  );
}
