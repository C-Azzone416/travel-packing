"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { customLocation, searchLocations } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";

// Whether a "Use “text” as typed" row is offered when nothing matches (#32). OFF until Caroline
// approves it; flipping this one constant turns the row on (the rest of the flow already handles it).
export const ALLOW_CUSTOM_DESTINATION = false;

export interface LocationPickerProps {
  query: string;
  onQueryChange: (text: string) => void;
  selected: SampleLocation | null;
  onSelect: (location: SampleLocation) => void;
  onClear: () => void;
  allowCustom?: boolean;
}

// An ARIA combobox over the curated list. Free text alone never confirms a location: the user
// must pick an option (or the explicit Custom row when enabled).
export function LocationPicker({
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

  const text = query.trim();
  const matches = selected || !text ? [] : searchLocations(query);
  const options: SampleLocation[] =
    allowCustom && text && matches.length === 0 && !selected ? [customLocation(text)] : matches;
  const showList = open && !selected && text !== "" && options.length > 0;
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
      setActive((current) => (current + step + options.length) % options.length);
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

  const announcement =
    selected || !text
      ? ""
      : matches.length === 0
        ? "No matches"
        : `${matches.length} ${matches.length === 1 ? "destination" : "destinations"} found`;

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
      {!selected && text && options.length === 0 ? (
        <div className="empty-state compact">No matches. Try a city name.</div>
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
