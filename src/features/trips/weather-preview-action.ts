"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { StopWeather } from "@/domain/weather/types";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { AuthFailure, requireOwner } from "@/server/auth/guard";
import { getDataContext } from "@/server/data/runtime";
import { readWeatherSettings } from "@/server/data/weather-store";
import { selectWeatherProvider } from "@/server/weather/provider-config";
import { createWeatherRateLimiter } from "@/server/weather/rate-limit";
import { unavailableStop, type WeatherStopInput } from "@/server/weather/provider";
import type { WeatherFetchResult } from "./weather-client";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stopInput = z.object({
  stopIndex: z.number().int().min(0).max(5),
  arrive: date,
  leave: date,
  includeLeave: z.boolean(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
});
const previewInput = z.array(stopInput).min(1).max(6);
const limiter = createWeatherRateLimiter();

/**
 * Weather for an unsaved draft. The action is owner-gated and accepts only provider-minimal coordinates/dates;
 * destination names, trip names, and identity never reach the weather provider.
 */
export async function previewWeatherAction(
  rawStops: WeatherStopInput[],
): Promise<WeatherFetchResult> {
  const parsed = previewInput.safeParse(rawStops);
  if (!parsed.success) return { kind: "unavailable" };
  const context = await getDataContext();
  if (!context) return { kind: "unavailable" };

  try {
    const session = await requireOwner(context.auth.provider, context.auth.allowlist);
    const settings = await readWeatherSettings(context.db, session.userId);
    if (!settings.weatherOptIn) return { kind: "ready", stops: [] };
    if (!limiter.consume(session.userId).ok) return { kind: "unavailable" };

    const provider = selectWeatherProvider();
    const stops: StopWeather[] = await Promise.all(
      parsed.data.map(async (stop) => {
        if (stop.latitude === undefined || stop.longitude === undefined) {
          return unavailableStop(stop.stopIndex);
        }
        try {
          return await provider.getStopWeather(stop);
        } catch {
          return unavailableStop(stop.stopIndex);
        }
      }),
    );
    return { kind: "ready", stops };
  } catch (error) {
    if (error instanceof AuthFailure) {
      redirect(error.code === "UNAUTHENTICATED" ? SIGN_IN_PATH : ACCESS_DENIED_PATH);
    }
    return { kind: "unavailable" };
  }
}
