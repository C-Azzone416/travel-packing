import type { Metadata } from "next";
import { StampsScreen } from "@/features/stamps/StampsScreen";

export const metadata: Metadata = { title: "Stamps" };

export default function StampsPage() {
  return <StampsScreen />;
}
