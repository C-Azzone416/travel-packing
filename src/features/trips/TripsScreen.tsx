"use client";

import { useState } from "react";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource } from "./trips-source";

// Temporary wiring: an in-memory source seeded with synthetic sample trips. #10 replaces
// this with the real data layer; the dashboard only ever sees the TripsSource port.
export function TripsScreen() {
  const [source] = useState(() =>
    createMemoryTripsSource(sampleLifecycleState(), { now: () => Date.now() }),
  );
  return <TripsDashboard source={source} />;
}
