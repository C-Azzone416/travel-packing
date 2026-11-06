import type { Metadata } from "next";
import { PlanScreen } from "@/features/plan/PlanScreen";

export const metadata: Metadata = { title: "Plan a trip" };

// `?copy=<trip id>` starts the same plan seeded with that trip's route and preferences.
export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string | string[] }>;
}) {
  const { copy } = await searchParams;
  return <PlanScreen copyId={typeof copy === "string" && copy ? copy : undefined} />;
}
