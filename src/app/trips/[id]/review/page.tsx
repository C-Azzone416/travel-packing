import type { Metadata } from "next";
import { ReviewScreen } from "@/features/trip/ReviewScreen";

export const metadata: Metadata = { title: "Review your bag" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewScreen tripId={id} />;
}
