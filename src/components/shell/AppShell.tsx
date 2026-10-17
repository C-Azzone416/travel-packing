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

export function AppShell({ children }: { children: ReactNode }) {
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
                <Link className="brand-button" href="/" aria-label="Go to trips">
                  <span className="brand-mark" aria-hidden="true">
                    ✦
                  </span>
                  <span>
                    <strong>Carrywell</strong>
                    <small>Caroline’s packing companion</small>
                  </span>
                </Link>
                <ConnectedSaveChip />
              </header>
              <main id="main" tabIndex={-1}>
                {children}
              </main>
              <Nav />
            </div>
            <RouteFocus />
          </AppLocationProvider>
        </TripsSourceProvider>
      </SaveStatusProvider>
    </ToastProvider>
  );
}
