import type { Metadata } from "next";
import { TripScreen } from "@/features/trip/TripScreen";

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string }>;
}) {
  const { id } = await params;
  // The dashboard's "+ Add item" lands here with the existing add form already open.
  const { add } = await searchParams;
  return <TripScreen tripId={id} openAdd={add === "item"} />;
}
