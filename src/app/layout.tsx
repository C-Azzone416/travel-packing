import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

// Screens set their own title; the template yields "Trips · Carrywell".
export const metadata: Metadata = { title: { default: "Carrywell", template: "%s · Carrywell" } };
export const viewport: Viewport = { themeColor: "#166D7A" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
