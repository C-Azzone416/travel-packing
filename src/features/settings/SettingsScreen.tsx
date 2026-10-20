"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import type { WeatherSettings } from "@/server/data/weather-store";
import type { WeatherSettingsResult } from "./weather-actions";

export interface SettingsScreenProps {
  /** The signed-in account, read on the server. Null only if the session vanished mid-request. */
  email: string | null;
  /** The sign-out form action (a server action; sign out goes straight through, with no confirm). */
  signOut: () => Promise<void>;
  initialWeather: WeatherSettings;
  updateWeather: (change: Partial<WeatherSettings>) => Promise<WeatherSettingsResult>;
}

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

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
}: SettingsScreenProps) {
  const { status, lastSavedAt, retry, track } = useSaveStatus();
  const toast = useToast();
  const unitsName = useId();
  const [weather, setWeather] = useState(initialWeather);
  const [weatherError, setWeatherError] = useState(false);

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

  return (
    <section className="screen">
      <div className="page-head">
        <div className="head-copy">
          <p className="eyebrow">Settings</p>
          <h1>Settings</h1>
          <p className="muted">Your account and how saving is going.</p>
        </div>
      </div>
      <div className="settings-grid">
        <Card as="section" padded aria-labelledby="settings-account">
          <h2 id="settings-account">Account</h2>
          {email ? (
            <p>
              Signed in as <strong>{email}</strong>
            </p>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </Card>
        <Card as="section" padded aria-labelledby="settings-save">
          <h2 id="settings-save">Save status</h2>
          {status === "error" ? (
            <>
              <p>Your last change hasn’t been saved. We’ll keep it on screen while you retry.</p>
              <Button onClick={retry}>Retry</Button>
            </>
          ) : status === "saving" ? (
            <p>Saving…</p>
          ) : lastSavedAt ? (
            <p>Everything you changed is saved.</p>
          ) : (
            <p>No changes yet this visit. Changes you make are saved as you go.</p>
          )}
          {lastSavedAt ? (
            <p className="tiny muted" role="status">
              {lastSavedText(lastSavedAt)}
            </p>
          ) : null}
        </Card>
        <Card as="section" padded aria-labelledby="settings-weather">
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
                  <span>{unit === "F" ? "°F (default)" : "°C"}</span>
                </label>
              ))}
            </div>
            <p className="tiny muted">
              {weather.weatherOptIn ? "Used for weather." : "Turn on weather to use units."}
            </p>
          </fieldset>
          {weatherError ? (
            <p className="field-error" role="alert">
              Couldn’t save that setting. Nothing was changed.
            </p>
          ) : null}
          <p className="weather-credit tiny muted">Weather data by Open-Meteo.com</p>
        </Card>
      </div>
    </section>
  );
}
