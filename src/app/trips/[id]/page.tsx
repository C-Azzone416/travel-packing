import type { Metadata } from "next";
import { itemIdFromQuery } from "@/features/trip/edit-link";
import { cubeFromQuery } from "@/features/trip/packing/packing-model";
import { TripScreen } from "@/features/trip/TripScreen";

export const metadata: Metadata = { title: "Packing list" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ edit?: string | string[]; cube?: string | string[] }>;
}) {
  const { id } = await params;
  const { edit, cube } = (await searchParams) ?? {};
  return (
    <TripScreen tripId={id} openItemId={itemIdFromQuery(edit)} openCube={cubeFromQuery(cube)} />
  );
}
