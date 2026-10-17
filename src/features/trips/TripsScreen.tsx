"use client";

import { TripsDashboard } from "./TripsDashboard";
import { useTripsSource } from "./TripsSourceProvider";

export function TripsScreen() {
  return <TripsDashboard source={useTripsSource()} />;
}
