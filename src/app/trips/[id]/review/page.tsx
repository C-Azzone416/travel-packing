import { redirect } from "next/navigation";

// The change-review step is now the live "What changes in your list" panel inside Edit trip (#389), so this address only
// forwards. `?review=1` is for the Ready final check, which comes back as a sheet on Packing (#411).
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/trips/${encodeURIComponent(id)}?review=1`);
}
