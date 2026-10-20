"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  archiveTripAction,
  createTripAction,
  createTripWithWeatherAction,
  loadTripsAction,
  removeTripAction,
  restoreTripAction,
  undoRemoveTripAction,
} from "./actions";
import { createServerTripsSource } from "./server-source";
import {
  applyWeatherReviewAction,
  acceptWeatherAction,
  addToiletryItemAction,
  confirmBagPlacementAction,
  decrementPackedAction,
  editItemAction,
  getTripAction,
  incrementPackedAction,
  listStaplesAction,
  listWeatherSuggestionsAction,
  markNotReadyAction,
  markReadyAction,
  removeItemAction,
  reviewWeatherAgainAction,
  setPackedAction,
  setStopsAction,
  setThemeAction,
  skipWeatherAction,
  togglePackedAction,
  undoBagPlacementAction,
  updatePreferencesAction,
  upsertStapleAction,
} from "./trip-actions";
import type { TripsSource } from "./trips-source";
import {
  getWeatherSettingsAction,
  updateWeatherSettingsAction,
} from "@/features/settings/weather-actions";
import { fetchTripWeather } from "./weather-client";
import { previewWeatherAction } from "./weather-preview-action";
import type { TripStop } from "@/domain/trip-stops";

const TripsSourceContext = createContext<TripsSource | null>(null);

export function useTripsSource(): TripsSource {
  const source = useContext(TripsSourceContext);
  if (!source) throw new Error("useTripsSource must be used inside <TripsSourceProvider>");
  return source;
}

// One source for the whole app, so a trip saved on one screen shows on the others. By default it reads and writes
// through the owner-gated data layer (server actions). Tests inject an in-memory source; no sample trips are
// bundled with the app.
export function TripsSourceProvider({
  source,
  children,
}: {
  source?: TripsSource;
  children: ReactNode;
}) {
  const [value] = useState<TripsSource>(
    () =>
      source ??
      createServerTripsSource(
        {
          load: loadTripsAction,
          archive: archiveTripAction,
          restore: restoreTripAction,
          remove: removeTripAction,
          undoRemove: undoRemoveTripAction,
          create: createTripAction,
        },
        {
          getTrip: getTripAction,
          listStaples: listStaplesAction,
          upsertStaple: upsertStapleAction,
          setPacked: setPackedAction,
          togglePacked: togglePackedAction,
          incrementPacked: incrementPackedAction,
          decrementPacked: decrementPackedAction,
          editItem: editItemAction,
          removeItem: removeItemAction,
          addToiletryItem: addToiletryItemAction,
          confirmBagPlacement: confirmBagPlacementAction,
          undoBagPlacement: undoBagPlacementAction,
          markReady: markReadyAction,
          markNotReady: markNotReadyAction,
          acceptWeather: acceptWeatherAction,
          skipWeather: skipWeatherAction,
          reviewWeatherAgain: reviewWeatherAgainAction,
          updatePreferences: updatePreferencesAction,
          setTheme: setThemeAction,
          setStops: setStopsAction,
        },
        {
          getSettings: getWeatherSettingsAction,
          updateSettings: updateWeatherSettingsAction,
          getTripWeather: fetchTripWeather,
          previewDraft: (stops: TripStop[]) =>
            previewWeatherAction(
              stops.map((stop, stopIndex, all) => ({
                stopIndex,
                arrive: stop.arrive,
                leave: stop.leave,
                includeLeave: stopIndex === all.length - 1,
                ...(stop.location.latitude === undefined
                  ? {}
                  : { latitude: stop.location.latitude }),
                ...(stop.location.longitude === undefined
                  ? {}
                  : { longitude: stop.location.longitude }),
              })),
            ),
          createTripWithReview: createTripWithWeatherAction,
          listSuggestions: listWeatherSuggestionsAction,
          applyReview: applyWeatherReviewAction,
        },
      ),
  );
  return <TripsSourceContext.Provider value={value}>{children}</TripsSourceContext.Provider>;
}
