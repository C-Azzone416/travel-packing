import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { APPEARANCE_COOKIE } from "@/domain/appearance";
import { appearanceForRequest } from "@/features/settings/saved-appearance";
import { AppShell } from "@/components/shell/AppShell";
import { signOutAction } from "@/app/sign-in/actions";
import { getAuth } from "@/server/auth/auth-runtime";
import { AUTH_SCREEN_HEADER } from "@/server/auth/proxy-handler";
import { fontClassNames } from "./fonts";
import "./ledger-tokens.css";
import "./globals.css";

// Screens set their own title; the template yields "Trips · Carrywell".
export const metadata: Metadata = { title: { default: "Carrywell", template: "%s · Carrywell" } };
export const viewport: Viewport = { themeColor: "#e9e3d6" };

/** Whose account the shell is for (shown only as the Sign out button's tooltip), or null if nobody is signed in. */
async function signedInEmail(): Promise<string | null> {
  try {
    return (await (await getAuth()).provider.getSession())?.email ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Sign-in and access-denied are shown on their own, without the app top bar or navigation. The proxy sets
  // this header (and strips any client-supplied one), so it cannot be used to hide the shell on app pages.
  const authScreen = (await headers()).get(AUTH_SCREEN_HEADER) === "1";
  const email = authScreen ? null : await signedInEmail();
  // The theme is rendered on <html> so the first paint is already themed; see ledger-tokens.css.
  const appearance = await appearanceForRequest(
    (await cookies()).get(APPEARANCE_COOKIE)?.value,
    email !== null,
  );
  return (
    <html lang="en" data-appearance={appearance} className={fontClassNames}>
      <body>
        {authScreen ? (
          children
        ) : (
          <AppShell signOut={signOutAction} email={email}>
            {children}
          </AppShell>
        )}
      </body>
    </html>
  );
}
