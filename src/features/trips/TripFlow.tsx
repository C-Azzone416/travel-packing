"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { calculateSuggestions } from "@/domain/calc";
import { curatedLocationProvider } from "@/domain/location-provider";
import { isCustomLocation } from "@/domain/locations";
import {
  draftStops,
  selectDraftLocation,
  setDraftConfig,
  setDraftStops,
  setDraftTheme,
  type LifecycleTrip,
  type SampleLocation,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { TripStop } from "@/domain/trip-stops";
import { diffRecommendations, type WeatherChange } from "@/domain/weather/diff";
import { recommendPacking, type WeatherRecommendation } from "@/domain/weather/recommend";
import type { StopWeather } from "@/domain/weather/types";
import type { WeatherSettings } from "@/server/data/weather-store";
import { localToday } from "@/lib/today";
import {
  clampOccasions,
  continueBlocker,
  copyDraft,
  describeChanges,
  isDirty,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  newDraft,
  returnOutfitHelp,
  withDates,
} from "./draft";
import { LocationPicker } from "./LocationPicker";
import { useLocationProvider } from "./LocationProviderContext";
import { StopList } from "./StopList";
import { addStop } from "./stops-draft";
import { ThemePicker } from "./ThemePicker";
import { useTripsSource } from "./TripsSourceProvider";
import { formatDays, formatRange } from "./view";

type Step = "details" | "shape";

const COPY_DATE_NOTICE = "Choose a new start date for the copy.";
type DraftWeather =
  | { kind: "hidden" }
  | { kind: "prompt"; settings: WeatherSettings }
  | { kind: "off"; settings: WeatherSettings }
  | { kind: "loading"; settings: WeatherSettings }
  | { kind: "offline"; settings: WeatherSettings }
  | { kind: "unavailable"; settings: WeatherSettings }
  | { kind: "ready"; settings: WeatherSettings; stops: StopWeather[] };

function recommendationForDraft(
  draft: TripDraft,
  stops: StopWeather[],
  route: TripStop[],
): WeatherRecommendation {
  return recommendPacking({
    days: stops.flatMap((stop) => stop.days),
    dayStopNames: route.map((stop) => stop.location.city),
    config: { ...draft.config, start: draft.start, end: draft.end },
    theme: draft.theme,
  });
}

/** A draft has no saved weather lines yet, so a review of it never proposes a removal. */
function acceptedDecision(change: Exclude<WeatherChange, { kind: "remove" }>) {
  if (change.kind === "add") {
    const { semanticId, name, category, qty, optional, groupId } = change.item;
    return {
      kind: "add" as const,
      semanticId: change.semanticId,
      ruleSignature: change.ruleSignature,
      item: {
        semanticId,
        name,
        category,
        qty,
        optional,
        ...(groupId ? { groupId } : {}),
      },
    };
  }
  return {
    kind: "split" as const,
    semanticId: change.semanticId,
    ruleSignature: change.ruleSignature,
    clothing: change.clothing,
  };
}

export interface TripFlowProps {
  copyId?: string;
  allowCustom?: boolean;
  getToday?: () => string;
}

export function TripFlow({ copyId, allowCustom, getToday = localToday }: TripFlowProps) {
  const source = useTripsSource();
  const [loaded, setLoaded] = useState<
    | { phase: "loading" }
    | { phase: "missing" }
    | { phase: "ready"; initial: TripDraft; from: LifecycleTrip | null }
  >(copyId ? { phase: "loading" } : { phase: "ready", initial: newDraft(), from: null });

  useEffect(() => {
    if (!copyId) return;
    let cancelled = false;
    source
      .load()
      .then((state) => {
        if (cancelled) return;
        const from = state.trips.find((trip) => trip.id === copyId);
        setLoaded(from ? { phase: "ready", initial: copyDraft(from), from } : { phase: "missing" });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ phase: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [source, copyId]);

  if (loaded.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading trip">
        <h1>Copy trip</h1>
      </section>
    );
  }

  if (loaded.phase === "missing") {
    return (
      <section className="screen">
        <h1>That trip isn’t available</h1>
        <p className="lede">It may have been removed. You can start a new trip instead.</p>
        <Link className={buttonClassName()} href="/">
          Back to trips
        </Link>
      </section>
    );
  }

  return (
    <FlowBody
      initial={loaded.initial}
      from={loaded.from}
      allowCustom={allowCustom}
      today={getToday()}
    />
  );
}

function FlowBody({
  initial,
  from,
  allowCustom,
  today,
}: {
  initial: TripDraft;
  from: LifecycleTrip | null;
  allowCustom?: boolean;
  today: string;
}) {
  const router = useRouter();
  const source = useTripsSource();
  const provider = useLocationProvider();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [step, setStep] = useState<Step>("details");
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState("");
  const [adjusted, setAdjusted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [weather, setWeather] = useState<DraftWeather>({ kind: "hidden" });

  const previewStops = useMemo(
    () =>
      draftStops(draft)
        .filter((stop): stop is typeof stop & { location: SampleLocation } =>
          Boolean(stop.location),
        )
        .map<TripStop>((stop) => ({
          location: stop.location,
          arrive: stop.arrive,
          leave: stop.leave,
        })),
    [draft],
  );

  const loadWeatherPreview = useCallback(
    async (knownSettings?: WeatherSettings) => {
      const weatherSource = source.weather;
      if (!weatherSource || previewStops.length === 0) {
        setWeather({ kind: "hidden" });
        return;
      }
      if (previewStops.every((stop) => isCustomLocation(stop.location))) {
        setWeather({ kind: "hidden" });
        return;
      }
      try {
        const settings = knownSettings ?? (await weatherSource.getSettings());
        if (!settings.weatherOptIn) {
          setWeather({ kind: "prompt", settings });
          return;
        }
        setWeather({ kind: "loading", settings });
        const result = await weatherSource.previewDraft(previewStops);
        if (result.kind === "offline") {
          setWeather({ kind: "offline", settings });
        } else if (result.kind === "unavailable") {
          setWeather({ kind: "unavailable", settings });
        } else {
          setWeather({ kind: "ready", settings, stops: result.stops });
        }
      } catch {
        setWeather((current) =>
          "settings" in current ? { kind: "unavailable", settings: current.settings } : current,
        );
      }
    },
    [previewStops, source],
  );

  const multi = Boolean(draft.stops && draft.stops.length > 1);
  // A copy of a multi-stop trip starts on the source's dates; the person must move the first arrival (every stop shifts).
  const staleCopy = multi && from !== null && draft.start === from.start;
  const blocker = staleCopy ? "Choose a new start date for the copy." : continueBlocker(draft);
  const eyebrow = from ? `Copy of ${from.destination}` : "New trip";
  void today;

  function requestCancel() {
    if (isDirty(draft, initial, query)) setDiscarding(true);
    else router.push("/");
  }

  function updateConfig(patch: Partial<TripConfig>) {
    const next = { ...draft.config, ...patch };
    const before = calculateSuggestions({ ...draft.config, start: draft.start, end: draft.end });
    const after = calculateSuggestions({ ...next, start: draft.start, end: draft.end });
    setDraft(setDraftConfig(draft, next));
    setAnnouncement(describeChanges(before, after));
  }

  function save() {
    setSaving(true);
    track(
      async () => {
        if (source.weather && weather.kind === "ready") {
          const recommendation = recommendationForDraft(draft, weather.stops, previewStops);
          const baseline = calculateSuggestions({
            ...draft.config,
            start: draft.start,
            end: draft.end,
          }).items;
          const changes = diffRecommendations(baseline, recommendation);
          return source.weather.createTripWithReview(
            draft,
            changes
              .filter(
                (change): change is Exclude<WeatherChange, { kind: "remove" }> =>
                  change.kind !== "remove",
              )
              .map(acceptedDecision),
          );
        }
        const created = await source.createTrip(draft);
        // "Not now" / weather off: the new trip starts with its weather prompt already answered, so the trip screen
        // shows "Weather is off" instead of asking again.
        if (source.weather && weather.kind === "off") {
          await source.skipWeather(created.id).catch(() => undefined);
        }
        return created;
      },
      () => {
        toast.show("Trip saved");
        router.push("/");
      },
    )
      .catch(() => undefined)
      .finally(() => setSaving(false));
  }

  async function setWeatherOptIn(weatherOptIn: boolean) {
    if (!source.weather || weather.kind === "hidden") return;
    try {
      const settings = await source.weather.updateSettings({ weatherOptIn });
      if (!weatherOptIn) setWeather({ kind: "off", settings });
      else await loadWeatherPreview(settings);
    } catch {
      toast.show("Couldn’t update weather. Nothing was changed.");
    }
  }

  const header = (title: string, lede: string, eyebrowText: string) => (
    <div className="page-head">
      <button
        className="back"
        type="button"
        aria-label="Cancel draft and return to trips"
        onClick={requestCancel}
      >
        ←
      </button>
      <div className="head-copy">
        <p className="eyebrow">{eyebrowText}</p>
        <h1>{title}</h1>
        <p className="muted">{lede}</p>
      </div>
    </div>
  );

  return (
    <section className="screen">
      {step === "details" ? (
        <>
          {header(
            "Confirm the trip",
            "This stays a draft and will not appear on the dashboard until you save it.",
            eyebrow,
          )}
          <form
            className="card panel form-grid"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocker) {
                setStep("shape");
                void loadWeatherPreview();
              }
            }}
          >
            {multi ? (
              <StopList
                stops={draft.stops ?? []}
                provider={provider}
                fallbackProvider={
                  provider === curatedLocationProvider ? undefined : curatedLocationProvider
                }
                allowCustom={allowCustom}
                attempted={attempted}
                firstQuery={query}
                arriveNotice={staleCopy ? COPY_DATE_NOTICE : undefined}
                onChange={(stops) => {
                  const next = setDraftStops(draft, stops);
                  setDraft(next);
                  // Back to one stop: the single-destination search box shows the remaining place again.
                  if (stops.length === 1 && stops[0].location) {
                    const place = stops[0].location;
                    setQuery(
                      place.id === "custom" ? place.label : `${place.city}, ${place.region}`,
                    );
                  }
                }}
              />
            ) : (
              <>
                <LocationPicker
                  provider={provider}
                  fallbackProvider={
                    provider === curatedLocationProvider ? undefined : curatedLocationProvider
                  }
                  allowCustom={allowCustom}
                  query={query}
                  onQueryChange={setQuery}
                  selected={draft.location}
                  onSelect={(location) => {
                    setDraft(selectDraftLocation(draft, location));
                    setQuery(
                      location.id === "custom"
                        ? location.label
                        : `${location.city}, ${location.region}`,
                    );
                  }}
                  onClear={() => setDraft({ ...draft, location: null })}
                />
                <div className="two-col">
                  <label className="field">
                    Leave
                    <input
                      name="start"
                      type="date"
                      value={draft.start}
                      required
                      aria-describedby="date-hint date-notice"
                      onChange={(event) => {
                        const change = withDates(draft, event.target.value, draft.end);
                        setDraft(change.draft);
                        setAdjusted(change.adjusted);
                      }}
                    />
                  </label>
                  <label className="field">
                    Return
                    <input
                      name="end"
                      type="date"
                      aria-describedby="date-hint date-notice"
                      value={draft.end}
                      min={draft.start || undefined}
                      required
                      onChange={(event) => {
                        const change = withDates(draft, draft.start, event.target.value);
                        setDraft(change.draft);
                        setAdjusted(change.adjusted);
                      }}
                    />
                  </label>
                </div>
                <div id="date-hint" className="tiny muted">
                  Same-day trips are allowed. Return cannot be before departure.
                </div>
                <p id="date-notice" className="notice" role="status" aria-label="Date notice">
                  {adjusted ? "Return date moved to match your departure." : ""}
                </p>
                <div className="add-stop-row">
                  <Button
                    variant="ghost"
                    className="add-stop"
                    onClick={() => setDraft(setDraftStops(draft, addStop(draftStops(draft))))}
                  >
                    + Add another stop
                  </Button>
                  <p className="tiny muted">
                    Visiting more than one place? Add each stop in order.
                  </p>
                </div>
              </>
            )}
            {draft.location ? (
              <ThemePicker
                value={draft.theme}
                onChange={(theme) => setDraft(setDraftTheme(draft, theme))}
              />
            ) : null}
            {from ? (
              <div className="callout">
                <strong>The original {from.destination} trip stays unchanged.</strong> This copy
                will recalculate suggestions and clear every packing checkmark only after Save trip.
              </div>
            ) : null}
            <div className="actions">
              <button
                className="button"
                type="submit"
                aria-disabled={blocker !== null}
                aria-describedby={blocker ? "continue-reason" : undefined}
                onClick={(event) => {
                  // aria-disabled keeps the button focusable so its reason can be reached; a press only
                  // emphasizes that reason.
                  if (!blocker) return;
                  event.preventDefault();
                  setAttempted(true);
                }}
              >
                Continue to packing preferences
              </button>
              <Button variant="secondary" onClick={requestCancel}>
                Cancel draft
              </Button>
            </div>
            {blocker ? (
              <p id="continue-reason" className={attempted ? "tiny field-error" : "tiny muted"}>
                {blocker}
              </p>
            ) : null}
          </form>
        </>
      ) : (
        <ShapeStep
          draft={draft}
          eyebrow={from ? `Unsaved copy of ${from.destination}` : "Unsaved trip draft"}
          header={header}
          saving={saving}
          announcement={announcement}
          weather={weather}
          weatherRoute={previewStops}
          onChange={updateConfig}
          onWeatherOptIn={(value) => void setWeatherOptIn(value)}
          onWeatherRefresh={() =>
            void loadWeatherPreview("settings" in weather ? weather.settings : undefined)
          }
          onBack={() => setStep("details")}
          onSave={save}
          onCancel={requestCancel}
        />
      )}

      <ModalSheet
        open={discarding}
        title="Discard this draft?"
        description="Nothing has been saved, so your trips stay as they are."
        onClose={() => setDiscarding(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => router.push("/")}>
              Discard
            </Button>
          </>
        }
      >
        {null}
      </ModalSheet>
    </section>
  );
}

interface ShapeStepProps {
  draft: TripDraft;
  eyebrow: string;
  header: (title: string, lede: string, eyebrow: string) => React.ReactNode;
  saving: boolean;
  announcement: string;
  weather: DraftWeather;
  weatherRoute: TripStop[];
  onChange: (patch: Partial<TripConfig>) => void;
  onWeatherOptIn: (value: boolean) => void;
  onWeatherRefresh: () => void;
  onBack: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function ShapeStep({
  draft,
  eyebrow,
  header,
  saving,
  announcement,
  weather,
  weatherRoute,
  onChange,
  onWeatherOptIn,
  onWeatherRefresh,
  onBack,
  onSave,
  onCancel,
}: ShapeStepProps) {
  const { config } = draft;
  const calculated = calculateSuggestions({ ...config, start: draft.start, end: draft.end });
  // Step 2 is only reachable once a destination is confirmed (Continue is blocked without one).
  const location = draft.location as SampleLocation;
  const stops = draftStops(draft);
  const where =
    stops.length > 1 ? stops.map((stop) => stop.location?.city).join(" → ") : location.label;
  const weatherItems =
    weather.kind === "ready"
      ? calculateSuggestions(
          { ...config, start: draft.start, end: draft.end },
          {
            days: weather.stops.flatMap((stop) => stop.days),
            stopNames: weatherRoute.map((stop) => stop.location.city),
            theme: draft.theme,
          },
        ).items
      : calculated.items;
  const weatherReasons = new Map(
    weatherItems
      .filter((item) => item.fromWeather && item.reason)
      .map((item) => [item.id, item.reason as string]),
  );

  return (
    <>
      {header(
        "Shape the list",
        `${where} · ${formatRange(draft)} · ${formatDays(calculated.days)}`,
        eyebrow,
      )}
      <div className="builder-layout">
        <Card padded>
          <h2>Your packing preferences</h2>
          <Switch
            label="Laundry access"
            description="Reduce repeatable everyday clothing."
            checked={config.laundry}
            onChange={(laundry) => onChange({ laundry })}
          />
          <Switch
            label="One spare underwear + socks"
            description="Added to the bag count, not the return outfit."
            checked={config.spare}
            onChange={(spare) => onChange({ spare })}
          />
          <Switch
            label="Nice outfits"
            description="Add planned occasion looks plus one editable Dress shoes, Makeup, and Dress-specific undergarments suggestion."
            checked={config.niceAttire}
            onChange={(niceAttire) => onChange({ niceAttire })}
          />
          <div className="two-col occasion-row">
            <label className="field">
              Occasions
              <input
                type="number"
                min={MIN_OCCASIONS}
                max={MAX_OCCASIONS}
                value={config.occasionCount}
                disabled={!config.niceAttire}
                onChange={(event) =>
                  onChange({ occasionCount: clampOccasions(event.target.valueAsNumber) })
                }
              />
            </label>
            <Switch
              label="Reuse one nice look"
              description="Repeat the same pieces."
              checked={config.reuseNice}
              disabled={!config.niceAttire}
              onChange={(reuseNice) => onChange({ reuseNice })}
            />
          </div>
          <Switch
            label="Dedicated return travel outfit"
            description={returnOutfitHelp(config.returnOutfit)}
            checked={config.returnOutfit}
            onChange={(returnOutfit) => onChange({ returnOutfit })}
          />
          <div className="callout">
            <strong>How counts work:</strong> the outbound outfit is worn, not packed.
          </div>
        </Card>
        <Card as="aside" padded>
          <p className="eyebrow">Live calculation</p>
          <h2>{calculated.dailyDays} everyday days</h2>
          <div className="count-summary">
            <div>
              <strong>{calculated.days}</strong>
              <span>TRIP DAYS</span>
            </div>
            <div>
              <strong>1</strong>
              <span>OUTBOUND WORN</span>
            </div>
            <div>
              <strong>{config.returnOutfit ? 1 : 0}</strong>
              <span>RETURN SET</span>
            </div>
          </div>
          {weather.kind === "prompt" ? (
            <div className="weather-card">
              <h3>Get weather for your stops?</h3>
              <p className="tiny muted">
                Only map coordinates and dates are sent to Open-Meteo. We never send your trip name,
                your places’ names, or who you are.
              </p>
              <p className="tiny muted">You can change this any time in Settings.</p>
              <div className="weather-opt-actions">
                <Button small onClick={() => onWeatherOptIn(true)}>
                  Get weather
                </Button>
                <Button variant="secondary" small onClick={() => onWeatherOptIn(false)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : null}
          {weather.kind === "off" ? (
            <div className="weather-card">
              <h3>Weather is off</h3>
              <Button variant="ghost" small onClick={() => onWeatherOptIn(true)}>
                Turn on
              </Button>
            </div>
          ) : null}
          {weather.kind === "loading" ? (
            <div className="weather-card" aria-busy="true">
              <h3>Loading weather…</h3>
            </div>
          ) : null}
          {weather.kind === "offline" || weather.kind === "unavailable" ? (
            <div className="weather-card">
              <h3>{weather.kind === "offline" ? "You’re offline" : "Weather isn’t available"}</h3>
              <p className="tiny muted">Your list still uses the standard packing calculation.</p>
              <Button variant="ghost" small onClick={onWeatherRefresh}>
                Try again
              </Button>
            </div>
          ) : null}
          {weather.kind === "ready" ? (
            <div className="weather-card">
              <span className="tag">Weather</span>
              <h3>Weather is shaping this list</h3>
              <p className="tiny muted">
                {weather.stops.some((stop) => stop.days.some((day) => day.source === "typical"))
                  ? "Forecast and typical conditions are reflected below."
                  : "The forecast for your stops is reflected below."}
              </p>
              <a
                className="tiny muted"
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Weather data by Open-Meteo.com
              </a>
            </div>
          ) : null}
          <div className="review-group">
            {weatherItems.map((item) => (
              <div key={item.id} className="review-row">
                <div>
                  <strong>{item.name}</strong>
                  <div className="item-meta">
                    {item.category}
                    {item.optional ? " · optional" : ""}
                  </div>
                  {weatherReasons.has(item.id) ? (
                    <div className="item-meta">
                      <span className="tag">Weather</span> {weatherReasons.get(item.id)}
                    </div>
                  ) : null}
                </div>
                <span className="tag">{item.qty}</span>
              </div>
            ))}
          </div>
          <p className="sr-only" role="status" aria-label="List changes">
            {announcement}
          </p>
          <div className="callout">
            <strong>Not on your dashboard yet.</strong> Review the details and preferences, then use
            Save trip.
          </div>
          <div className="actions">
            <Button disabled={saving} aria-busy={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save trip"}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={onBack}>
              Edit trip details
            </Button>
            <Button variant="ghost" disabled={saving} onClick={onCancel}>
              Cancel draft
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
