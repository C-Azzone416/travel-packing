import type { Metadata } from "next";
import { itemIdFromQuery } from "@/features/trip/edit-link";
import { cubeFromQuery } from "@/features/trip/packing/packing-model";
import { TripScreen } from "@/features/trip/TripScreen";
import { ReviewScreen } from "@/features/trip/ReviewScreen";

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    edit?: string | string[];
    cube?: string | string[];
    review?: string | string[];
  }>;
}) {
  const { id } = await params;
  const { edit, cube, review } = (await searchParams) ?? {};
  // #389 moves the old URL onto Packing. #411 will present this same final Ready check as a sheet.
  if (review === "1") return <ReviewScreen tripId={id} />;
  return (
    <TripScreen tripId={id} openItemId={itemIdFromQuery(edit)} openCube={cubeFromQuery(cube)} />
  );
}
