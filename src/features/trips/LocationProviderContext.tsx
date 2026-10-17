"use client";

import { createContext, useContext, type ReactNode } from "react";
import { curatedLocationProvider, type LocationProvider } from "@/domain/location-provider";

const LocationProviderContext = createContext<LocationProvider>(curatedLocationProvider);

/** The provider behind the destination picker. Defaults to the curated list; #47 supplies a geocoding adapter. */
export function useLocationProvider(): LocationProvider {
  return useContext(LocationProviderContext);
}

export function LocationProviderProvider({
  provider,
  children,
}: {
  provider: LocationProvider;
  children: ReactNode;
}) {
  return (
    <LocationProviderContext.Provider value={provider}>{children}</LocationProviderContext.Provider>
  );
}
