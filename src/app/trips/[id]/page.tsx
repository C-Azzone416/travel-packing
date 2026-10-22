import type { Metadata } from "next";
import { itemIdFromQuery } from "@/features/trip/edit-link";
import { TripScreen } from "@/features/trip/TripScreen";

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ edit?: string | string[] }>;
}) {
  const { id } = await params;
  const { edit } = (await searchParams) ?? {};
  return <TripScreen tripId={id} openItemId={itemIdFromQuery(edit)} />;
}
