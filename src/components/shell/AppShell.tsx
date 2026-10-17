import Link from "next/link";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { Nav } from "./Nav";
import { PreviewBanner } from "./PreviewBanner";
import { RouteFocus } from "./RouteFocus";
import { SaveChip } from "./SaveChip";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
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
          <SaveChip />
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Nav />
      </div>
      <RouteFocus />
    </ToastProvider>
  );
}
