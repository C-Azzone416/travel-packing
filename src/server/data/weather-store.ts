// Weather storage that is not part of the trip aggregate: the person's weather settings (on their users row) and the
// status of each weather-driven suggestion on a trip (one row per trip and semantic id). Raw weather is never
// stored; a suggestion keeps only its status and a short signature of the rule that fired. Every query is owner-scoped.

import { and, eq } from "drizzle-orm";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";

export type TemperatureUnit = (typeof schema.TEMPERATURE_UNITS)[number];
export type SuggestionStatus = (typeof schema.WEATHER_STATUSES)[number];

export interface WeatherSettings {
  weatherOptIn: boolean;
  temperatureUnit: TemperatureUnit;
}

export interface WeatherSuggestionState {
  semanticId: string;
  status: SuggestionStatus;
  ruleSignature: string;
}

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  weatherOptIn: false,
  temperatureUnit: "F",
};

export async function readWeatherSettings(db: Db, ownerId: string): Promise<WeatherSettings> {
  const [row] = await db
    .select({
      weatherOptIn: schema.users.weatherOptIn,
      temperatureUnit: schema.users.temperatureUnit,
    })
    .from(schema.users)
    .where(eq(schema.users.id, ownerId));
  return row ?? DEFAULT_WEATHER_SETTINGS;
}

/** Change only the settings given. The owner's users row exists by the time any entry point runs. */
export async function writeWeatherSettings(
  db: Db,
  ownerId: string,
  change: Partial<WeatherSettings>,
): Promise<WeatherSettings> {
  if (change.weatherOptIn !== undefined || change.temperatureUnit !== undefined) {
    await db
      .update(schema.users)
      .set({
        ...(change.weatherOptIn === undefined ? {} : { weatherOptIn: change.weatherOptIn }),
        ...(change.temperatureUnit === undefined
          ? {}
          : { temperatureUnit: change.temperatureUnit }),
      })
      .where(eq(schema.users.id, ownerId));
  }
  return readWeatherSettings(db, ownerId);
}

export async function listWeatherSuggestions(
  db: Db,
  ownerId: string,
  tripId: string,
): Promise<WeatherSuggestionState[]> {
  const rows = await db
    .select({
      semanticId: schema.weatherSuggestions.semanticId,
      status: schema.weatherSuggestions.status,
      ruleSignature: schema.weatherSuggestions.ruleSignature,
    })
    .from(schema.weatherSuggestions)
    .where(
      and(
        eq(schema.weatherSuggestions.tripId, tripId),
        eq(schema.weatherSuggestions.ownerId, ownerId),
      ),
    )
    .orderBy(schema.weatherSuggestions.semanticId);
  return rows;
}

/**
 * Record the status of one suggestion on one of the owner's trips. Returns false when the trip is not the
 * owner's (the composite foreign key would refuse it too, but this answers without an error).
 */
export async function writeWeatherSuggestion(
  db: Db,
  ownerId: string,
  tripId: string,
  state: WeatherSuggestionState,
): Promise<boolean> {
  const owned = await db
    .select({ id: schema.trips.id })
    .from(schema.trips)
    .where(and(eq(schema.trips.id, tripId), eq(schema.trips.ownerId, ownerId)));
  if (owned.length === 0) return false;
  await db
    .insert(schema.weatherSuggestions)
    .values({ tripId, ownerId, ...state })
    .onConflictDoUpdate({
      target: [schema.weatherSuggestions.tripId, schema.weatherSuggestions.semanticId],
      set: {
        status: state.status,
        ruleSignature: state.ruleSignature,
        updatedAt: new Date(),
      },
    });
  return true;
}
