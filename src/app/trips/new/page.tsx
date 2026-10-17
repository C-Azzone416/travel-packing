import type { Metadata } from "next";
import { TripFlow } from "@/features/trips/TripFlow";

export const metadata: Metadata = { title: "New trip" };

// `?copy=<trip id>` starts the same flow seeded with that trip's preferences.
export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string | string[] }>;
}) {
  const { copy } = await searchParams;
  return <TripFlow copyId={typeof copy === "string" && copy ? copy : undefined} />;
}
