import Link from "next/link";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { AppLocationProvider } from "@/features/trips/AppLocationProvider";
import { providerEnabled } from "@/server/locations/provider-config";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { Nav } from "./Nav";
import { PreviewBanner } from "./PreviewBanner";
import { RouteFocus } from "./RouteFocus";
import { ConnectedSaveChip, SaveStatusProvider } from "./SaveStatus";

export interface AppShellProps {
  children: ReactNode;
  /** Both given: the nav gets a Sign out item (#117). */
  signOut?: () => Promise<void>;
  email?: string | null;
}

export function AppShell({ children, signOut, email }: AppShellProps) {
  return (
    <ToastProvider>
      <SaveStatusProvider>
        <TripsSourceProvider>
          <AppLocationProvider providerOn={providerEnabled()}>
            <a className="skip-link" href="#main">
              Skip to main content
            </a>
            <PreviewBanner />
            <div className="app-shell">
              <header className="topbar">
                <div className="topbar-inner">
                  <Link className="brand-button" href="/" aria-label="Packed Smart: go to trips">
                    <span className="brand-mark" aria-hidden="true" />
                    <strong>Packed Smart</strong>
                  </Link>
                  <Nav signOut={signOut} email={email} />
                  <ConnectedSaveChip />
                </div>
              </header>
              <main id="main" tabIndex={-1}>
                {children}
              </main>
            </div>
            <RouteFocus />
          </AppLocationProvider>
        </TripsSourceProvider>
      </SaveStatusProvider>
    </ToastProvider>
  );
}
