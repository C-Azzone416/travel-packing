"use server";

import { redirect } from "next/navigation";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";
import { DEFAULT_WEATHER_SETTINGS, type WeatherSettings } from "@/server/data/weather-store";
import type { ErrorCode } from "@/server/data/result";

export type WeatherSettingsResult =
  | { ok: true; settings: WeatherSettings }
  | { ok: false; code: ErrorCode; settings: WeatherSettings };

async function runWeatherSettings(
  change?: Partial<WeatherSettings>,
): Promise<WeatherSettingsResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL", settings: DEFAULT_WEATHER_SETTINGS };
  const result = change
    ? await service.updateWeatherSettings(context, change)
    : await service.getWeatherSettings(context);
  if (result.ok) return { ok: true, settings: result.data };
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (result.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: result.error.code, settings: DEFAULT_WEATHER_SETTINGS };
}

export function getWeatherSettingsAction(): Promise<WeatherSettingsResult> {
  return runWeatherSettings();
}

export function updateWeatherSettingsAction(
  change: Partial<WeatherSettings>,
): Promise<WeatherSettingsResult> {
  return runWeatherSettings(change);
}
