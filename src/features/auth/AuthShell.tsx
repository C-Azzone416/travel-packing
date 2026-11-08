import type { ReactNode } from "react";
import { NavIcon } from "@/components/shell/NavIcon";
import { AuthSuitcase } from "./AuthSuitcase";

/**
 * The frame every signed-out screen shares: a non-interactive brand bar and the open auth suitcase (#424). The brand is not
 * a link, so Email (or the screen's first control) remains the first interactive stop.
 */
export function AuthShell({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <>
      <header className="auth-brandbar">
        <div className="auth-brandbar-inner">
          <span className="brand-button">
            <span className="brand-mark" aria-hidden="true">
              <NavIcon name="trips" />
            </span>
            <strong>Packed Smart</strong>
          </span>
        </div>
      </header>
      <main className="auth-screen">
        <AuthSuitcase banner={banner}>{children}</AuthSuitcase>
      </main>
    </>
  );
}
