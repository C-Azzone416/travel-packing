"use client";

import type { ReactNode } from "react";
import { createApiLocationProvider } from "./api-location-provider";
import { LocationProviderProvider } from "./LocationProviderContext";

// The app's destination search goes through this app's own owner-only endpoint; the server decides
// which source answers (curated list by default). The server also says whether the real provider is on, so
// its required credit shows only then. Each is created once, so identity is stable.
const curated = createApiLocationProvider();
const credited = createApiLocationProvider({ credited: true });

export function AppLocationProvider({
  children,
  providerOn = false,
}: {
  children: ReactNode;
  /** The server's LOCATION_PROVIDER is "open-meteo". */
  providerOn?: boolean;
}) {
  return (
    <LocationProviderProvider provider={providerOn ? credited : curated}>
      {children}
    </LocationProviderProvider>
  );
}
