import type { Metadata } from "next";
import { TripsScreen } from "@/features/trips/TripsScreen";
import { homeMaps } from "@/features/trips/home-maps";

// The root layout's title template skips the page in its own segment, so the
// home screen spells out its full title.
export const metadata: Metadata = { title: { absolute: "Trips · Packed Smart" } };

// The laptop Home draws the next trip's route on a map. The map is a server component, so it is drawn here and handed to
// the (client) screen, which shows it for the trip it picks.
export default async function TripsPage() {
  return <TripsScreen maps={await homeMaps()} />;
}
