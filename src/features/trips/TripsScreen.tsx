"use client";

import { TripsDashboard } from "./TripsDashboard";
import { useTripsSource } from "./TripsSourceProvider";
import type { HomeMaps } from "./home-map-types";

export function TripsScreen({ maps }: { maps?: HomeMaps }) {
  return <TripsDashboard source={useTripsSource()} maps={maps} />;
}
