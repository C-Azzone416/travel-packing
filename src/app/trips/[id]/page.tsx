import type { Metadata } from "next";
import { itemIdFromQuery } from "@/features/trip/edit-link";
import { cubeFromQuery } from "@/features/trip/packing/packing-model";
import { TripScreen } from "@/features/trip/TripScreen";

type SearchParams = {
  edit?: string | string[];
  cube?: string | string[];
  review?: string | string[];
};

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const { edit, cube, review } = (await searchParams) ?? {};
  // `/trips/[id]/review` forwards here with ?review=1: the Ready final check is the "Review your bag" sheet on Packing (#411).
  return (
    <TripScreen
      tripId={id}
      openItemId={itemIdFromQuery(edit)}
      openCube={cubeFromQuery(cube)}
      openReview={review === "1"}
    />
  );
}
