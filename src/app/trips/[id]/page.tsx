import type { Metadata } from "next";
import { itemIdFromQuery } from "@/features/trip/edit-link";
import { cubeFromQuery } from "@/features/trip/packing/packing-model";
import { ReviewScreen } from "@/features/trip/ReviewScreen";
import { TripScreen } from "@/features/trip/TripScreen";

type SearchParams = {
  edit?: string | string[];
  cube?: string | string[];
  review?: string | string[];
};

const packing: Metadata = { title: "Packing list" };

// `/trips/[id]/review` forwards here with ?review=1 (#389). Until the Ready final check becomes the "Review your bag" sheet on
// Packing (#411), ?review=1 shows that check (ReviewScreen) so Ready stays reachable; nothing else about the page changes.
const wantsReview = (review: string | string[] | undefined) => review === "1";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}): Promise<Metadata> {
  const { review } = (await searchParams) ?? {};
  return wantsReview(review) ? { title: "Review your bag" } : packing;
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const { edit, cube, review } = (await searchParams) ?? {};
  if (wantsReview(review)) return <ReviewScreen tripId={id} />;
  return (
    <TripScreen tripId={id} openItemId={itemIdFromQuery(edit)} openCube={cubeFromQuery(cube)} />
  );
}
