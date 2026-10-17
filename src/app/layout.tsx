import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { AUTH_SCREEN_HEADER } from "@/server/auth/proxy-handler";
import "./globals.css";

// Screens set their own title; the template yields "Trips · Carrywell".
export const metadata: Metadata = { title: { default: "Carrywell", template: "%s · Carrywell" } };
export const viewport: Viewport = { themeColor: "#166D7A" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Sign-in and access-denied are shown on their own, without the app top bar or navigation. The proxy sets
  // this header (and strips any client-supplied one), so it cannot be used to hide the shell on app pages.
  const authScreen = (await headers()).get(AUTH_SCREEN_HEADER) === "1";
  return (
    <html lang="en">
      <body>{authScreen ? children : <AppShell>{children}</AppShell>}</body>
    </html>
  );
}
