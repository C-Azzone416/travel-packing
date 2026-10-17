"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const TripsSourceContext = createContext<TripsSource | null>(null);

export function useTripsSource(): TripsSource {
  const source = useContext(TripsSourceContext);
  if (!source) throw new Error("useTripsSource must be used inside <TripsSourceProvider>");
  return source;
}

// One source for the whole app, so a trip saved on one screen shows on the others. Until #10
// lands this is an in-memory source seeded with synthetic sample trips; #10 swaps it for the
// real data layer here and nothing else changes.
export function TripsSourceProvider({
  source,
  children,
}: {
  source?: TripsSource;
  children: ReactNode;
}) {
  const [value] = useState<TripsSource>(
    () => source ?? createMemoryTripsSource(sampleLifecycleState(), { now: () => Date.now() }),
  );
  return <TripsSourceContext.Provider value={value}>{children}</TripsSourceContext.Provider>;
}
