import type { Metadata } from "next";
import { TripScreen } from "@/features/trip/TripScreen";

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripScreen tripId={id} />;
}
