import type { Metadata } from "next";
import { StaplesScreen } from "@/features/staples/StaplesScreen";

export const metadata: Metadata = { title: "Staples" };

export default function StaplesPage() {
  return <StaplesScreen />;
}
