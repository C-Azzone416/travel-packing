import type { Metadata } from "next";
import { TripsScreen } from "@/features/trips/TripsScreen";

// The root layout's title template skips the page in its own segment, so the
// home screen spells out its full title.
export const metadata: Metadata = { title: { absolute: "Trips · Carrywell" } };

export default function TripsPage() {
  return <TripsScreen />;
}
