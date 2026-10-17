"use client";

import type { ReactNode } from "react";
import { createApiLocationProvider } from "./api-location-provider";
import { LocationProviderProvider } from "./LocationProviderContext";

// The app's destination search goes through this app's own owner-only endpoint; the server decides
// which source answers (curated list by default). Created once, so its identity is stable.
const apiLocationProvider = createApiLocationProvider();

export function AppLocationProvider({ children }: { children: ReactNode }) {
  return (
    <LocationProviderProvider provider={apiLocationProvider}>{children}</LocationProviderProvider>
  );
}
