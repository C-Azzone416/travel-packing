"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Suitcase } from "@/components/suitcase/Suitcase";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { useSignOut } from "@/components/shell/use-sign-out";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import type { TripOrigin } from "@/domain/trip-route";
import {
  APPEARANCE_COOKIE,
  appearanceCookieString,
  parseAppearance,
  type Appearance,
} from "@/domain/appearance";
import { FeedbackSettings } from "@/features/feedback/FeedbackSettings";
import { LocationPicker } from "@/features/trips/LocationPicker";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import type { WeatherSettings } from "@/server/data/weather-store";
import type { AppearanceResult } from "./appearance-actions";
import { CloseAccountSheet } from "./CloseAccountSheet";
import type { CloseAccountState } from "./close-account-state";
import { ThemePicker } from "./ThemePicker";
import type { WeatherSettingsResult } from "./weather-actions";
import type { HomeCityResult } from "./home-actions";

export interface SettingsScreenProps {
  /** The signed-in account, read on the server. Null only if the session vanished mid-request. */
  email: string | null;
  /** The sign-out form action (a server action; sign out goes straight through, with no confirm). */
  signOut: () => Promise<void>;
  initialWeather: WeatherSettings;
  updateWeather: (change: Partial<WeatherSettings>) => Promise<WeatherSettingsResult>;
  /** The theme saved on the account (Ocean when none was chosen). */
  initialAppearance: Appearance;
  updateAppearance: (appearance: Appearance) => Promise<AppearanceResult>;
  /** The owner-level default From place. Existing trips keep their own stored copy. */
  initialHome?: TripOrigin | null;
  updateHomeCity?: (location: SampleLocation | null) => Promise<HomeCityResult>;
  /** Server-side rollout decision. Missing or invalid configuration passes false and hides every closure entry point. */
  accountClosureEnabled: boolean;
  closeAccount: (previous: CloseAccountState, formData: FormData) => Promise<CloseAccountState>;
}

/** Show a theme now: the attribute drives the role tokens, the cookie lets the server render it before first paint. */
function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.scheme = appearance;
  document.cookie = appearanceCookieString(appearance, window.location.protocol === "https:");
}

/** The theme the page is showing right now (what the server rendered), read from the document. */
function shownAppearance(): Appearance {
  return parseAppearance(document.documentElement.dataset.scheme);
}

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

type SaveView = "failed" | "saving" | "saved" | "upToDate";

// One card state per row of the design table (#298). Order matters: a failure or a pending write always wins.
const SAVE_VIEW: Record<SaveView, { glyph: string; line: string }> = {
  failed: { glyph: "!", line: "Not saved" },
  saving: { glyph: "●", line: "Saving…" },
  saved: { glyph: "✓", line: "Saved" },
  upToDate: { glyph: "✓", line: "Up to date" },
};

/** "Last saved 3:42 PM". Shown only after a real write; before one there is nothing to report. */
export function lastSavedText(savedAt: Date): string {
  return `Last saved ${TIME.format(savedAt)}`;
}

// Settings (#19, design's #31): Account, then Save status. No Data section until export/import (#24) exists, and no
// simulated-sync or sample-data controls: saving is real, and the state shown is derived from what the server said.
export function SettingsScreen({
  email,
  signOut,
  initialWeather,
  updateWeather,
  initialAppearance,
  updateAppearance,
  initialHome = null,
  updateHomeCity = async (location) => ({
    ok: true as const,
    home: location ? { location } : null,
  }),
  accountClosureEnabled,
  closeAccount,
}: SettingsScreenProps) {
  const { status, lastSavedAt, retry, track, pending } = useSaveStatus();
  const signOutGuard = useSignOut(signOut);
  const toast = useToast();
  const locationProvider = useLocationProvider();
  const unitsName = useId();
  const [weather, setWeather] = useState(initialWeather);
  const [weatherError, setWeatherError] = useState(false);
  const [appearance, setAppearance] = useState(initialAppearance);
  const [appearanceError, setAppearanceError] = useState(false);
  const [home, setHome] = useState<TripOrigin | null>(initialHome);
  const [homeError, setHomeError] = useState(false);
  const [homePickerOpen, setHomePickerOpen] = useState(false);
  const [homeQuery, setHomeQuery] = useState("");
  const [homeChoice, setHomeChoice] = useState<SampleLocation | null>(null);
  // Home changes stay optimistic, but their server writes run in intent order. The id also makes a
  // failed/successful completion harmless once the owner has chosen something newer.
  const homeWriteId = useRef(0);
  const homeWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const confirmedHome = useRef<TripOrigin | null>(initialHome);
  const [closingAccount, setClosingAccount] = useState(false);

  // The account's theme is the truth. If this device was showing another one (a new device, or a choice made
  // elsewhere), show the account's now and refresh the cookie. This never writes to the account.
  useEffect(() => {
    const mirrored = document.cookie
      .split("; ")
      .includes(`${APPEARANCE_COOKIE}=${initialAppearance}`);
    if (shownAppearance() !== initialAppearance || !mirrored) applyAppearance(initialAppearance);
  }, [initialAppearance]);

  function chooseAppearance(next: Appearance) {
    if (next === appearance) return;
    setAppearanceError(false);
    const previous = appearance;
    setAppearance(next);
    applyAppearance(next);
    void track(
      async () => {
        const result = await updateAppearance(next);
        if (!result.ok) throw new Error(result.code);
        return result.appearance;
      },
      () => undefined,
    ).catch(() => {
      setAppearance(previous);
      applyAppearance(previous);
      setAppearanceError(true);
    });
  }

  function saveWeather(change: Partial<WeatherSettings>, offMessage = false) {
    setWeatherError(false);
    const previous = weather;
    setWeather({ ...weather, ...change });
    void track(
      async () => {
        const result = await updateWeather(change);
        if (!result.ok) throw new Error(result.code);
        return result.settings;
      },
      (saved) => {
        setWeather(saved);
        if (offMessage) toast.show("Weather is off. Your lists are unchanged.");
      },
    ).catch(() => {
      setWeather(previous);
      setWeatherError(true);
    });
  }

  function saveHome(next: SampleLocation | null, cleared = false) {
    const writeId = ++homeWriteId.current;
    setHomeError(false);
    const previous = home;
    setHome(next ? { location: next } : null);
    setHomePickerOpen(false);

    const stale = { kind: "stale" as const };
    const write = () => {
      // Retry never replays an intent that the owner has already replaced.
      if (writeId !== homeWriteId.current) return Promise.resolve(stale);
      const queued = homeWriteQueue.current.then(async () => {
        if (writeId !== homeWriteId.current) return stale;
        const result = await updateHomeCity(next);
        // A successful response is the newest server-confirmed state even when a later UI intent
        // has already replaced it. A later failure must roll back to this, not to optimistic UI.
        if (result.ok) confirmedHome.current = result.home;
        // Normalize an obsolete completion before SaveStatus sees it, so it cannot replace a newer
        // failure/Retry or clear the newer failure by completing later.
        if (writeId !== homeWriteId.current) return stale;
        if (!result.ok) throw new Error(result.code);
        return { kind: "saved" as const, home: result.home };
      });
      homeWriteQueue.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    };

    void track(write, (outcome) => {
      if (outcome.kind === "stale" || writeId !== homeWriteId.current) return;
      setHomeError(false);
      setHome(outcome.home);
      if (cleared && previous) {
        toast.show("Home city cleared.", {
          action: {
            label: "Undo",
            onAction: () => saveHome(previous.location),
          },
        });
      }
    }).catch(() => {
      if (writeId !== homeWriteId.current) return;
      setHome(confirmedHome.current);
      setHomeError(true);
    });
  }

  const view: SaveView =
    status === "error"
      ? "failed"
      : status === "saving" || pending
        ? "saving"
        : status === "saved"
          ? "saved"
          : "upToDate";
  // A detail line only where it says something: the failure, or the last real save once there is one.
  const detail =
    view === "failed"
      ? "Your change is still on screen."
      : view === "upToDate" && lastSavedAt
        ? lastSavedText(lastSavedAt)
        : null;

  return (
    <section className="screen settings-screen">
      <div className="page-head settings-head">
        <div className="head-copy">
          <h1>Settings</h1>
          <p className="muted">Your home city, colours, weather and account.</p>
        </div>
      </div>
      <Suitcase interior="dark" inset="staples" className="settings-suitcase">
        <div className="settings-cubes">
          <section className="settings-cube" aria-labelledby="settings-home">
            <h2 id="settings-home">Home</h2>
            <p className="eyebrow">Home city</p>
            <button
              type="button"
              className="home-city-field"
              aria-labelledby="settings-home-city-control-name"
              onClick={() => {
                setHomeQuery("");
                setHomeChoice(null);
                setHomePickerOpen(true);
              }}
            >
              <span
                aria-hidden="true"
                className={home ? "" : "home-city-placeholder"}
                data-text={home?.location.city ?? "Choose your home city"}
              />
              <span
                aria-hidden="true"
                className="home-city-change"
                data-text={home ? "Change" : "+"}
              />
              <span id="settings-home-city-control-name" className="sr-only">
                {home ? `Home city: ${home.location.city}, change` : "Home city, choose"}
              </span>
            </button>
            <p className="settings-help">
              Used as the “From” for new trips. You can change it on any trip.
            </p>
            <p className="settings-help">Trips you already planned keep their own “From”.</p>
            {home ? (
              <button
                type="button"
                className="settings-text-button"
                onClick={() => saveHome(null, true)}
              >
                Clear
              </button>
            ) : null}
            {homeError ? (
              <p className="field-error" role="alert">
                Couldn’t save your home city. Nothing was changed.
              </p>
            ) : null}
          </section>

          <section className="settings-cube" aria-labelledby="settings-theme">
            <h2 id="settings-theme">Colour scheme</h2>
            <p className="muted settings-cube-intro">Applies on all your devices.</p>
            <ThemePicker value={appearance} onChange={chooseAppearance} />
            {appearanceError ? (
              <p className="field-error" role="alert">
                Couldn’t save that theme. Nothing was changed.
              </p>
            ) : null}
          </section>

          <section className="settings-cube" aria-labelledby="settings-weather">
            <h2 id="settings-weather">Weather and units</h2>
            <Switch
              label="Weather for my trips"
              description="Uses Open-Meteo. Only map coordinates and dates are sent."
              checked={weather.weatherOptIn}
              onChange={(weatherOptIn) => saveWeather({ weatherOptIn }, !weatherOptIn)}
            />
            <fieldset className="temperature-units">
              <legend>Temperature units</legend>
              <div className="temperature-unit-options">
                {(["F", "C"] as const).map((unit) => (
                  <label key={unit}>
                    <input
                      type="radio"
                      name={unitsName}
                      value={unit}
                      checked={weather.temperatureUnit === unit}
                      disabled={!weather.weatherOptIn}
                      onChange={() => saveWeather({ temperatureUnit: unit })}
                    />
                    <span>{unit === "F" ? "°F" : "°C"}</span>
                  </label>
                ))}
              </div>
              <p className="tiny muted">
                {weather.weatherOptIn ? "°F is the default." : "Turn on weather to use units."}
              </p>
            </fieldset>
            {weatherError ? (
              <p className="field-error" role="alert">
                Couldn’t save that setting. Nothing was changed.
              </p>
            ) : null}
            <p className="weather-credit tiny muted">Weather data by Open-Meteo.com</p>
          </section>

          <section className="settings-cube" aria-labelledby="settings-saving">
            <h2 id="settings-saving">Saving</h2>
            <h3 className="sr-only">Save status</h3>
            <div className="save-status">
              <div className="save-status-main">
                <span className={`save-status-glyph save-status-glyph-${view}`} aria-hidden="true">
                  {SAVE_VIEW[view].glyph}
                </span>
                <div className="save-status-text">
                  <p className={`save-status-line save-status-line-${view}`}>
                    {SAVE_VIEW[view].line}
                  </p>
                  {detail ? <p className="save-status-detail">{detail}</p> : null}
                </div>
              </div>
              {view === "failed" ? <Button onClick={retry}>Retry</Button> : null}
            </div>
          </section>

          <FeedbackSettings />

          <section className="settings-cube" aria-labelledby="settings-account">
            <h2 id="settings-account">Account</h2>
            {email ? (
              <p data-feedback-identity data-feedback-exclude="account-identity">
                Signed in as <strong>{email}</strong>
              </p>
            ) : null}
            <form action={signOutGuard.action}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
            {signOutGuard.sheet}
            {accountClosureEnabled ? (
              <div className="close-account-entry">
                <h3>Close account</h3>
                <p className="muted">
                  Permanently remove your account identity and Packed Smart content.
                </p>
                <Button variant="danger" onClick={() => setClosingAccount(true)}>
                  Close account
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </Suitcase>

      <ModalSheet
        open={homePickerOpen}
        title="Choose your home city"
        description="New trips use this as their starting point."
        onClose={() => setHomePickerOpen(false)}
        showClose
      >
        <LocationPicker
          provider={locationProvider}
          query={homeQuery}
          onQueryChange={setHomeQuery}
          selected={homeChoice}
          onSelect={(location) => {
            setHomeChoice(location);
            saveHome(location);
          }}
          onClear={() => {
            setHomeChoice(null);
            setHomeQuery("");
          }}
          label="Home city search"
        />
      </ModalSheet>
      {accountClosureEnabled && closingAccount ? (
        <CloseAccountSheet action={closeAccount} onClose={() => setClosingAccount(false)} />
      ) : null}
    </section>
  );
}
