import type { ReactNode } from "react";

/**
 * The frame every signed-out screen shares (Field Ledger, #204): the slim brand-only bar (the app header's height, circle and
 * wordmark, with no navigation and no status chip), then the top-aligned screen. The brand is not a link: signed out, there is
 * nowhere else to go, and it keeps one stop out of the tab order.
 */
export function AuthShell({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <>
      <header className="auth-brandbar">
        <div className="auth-brandbar-inner">
          <span className="brand-button">
            <span className="brand-mark" aria-hidden="true" />
            <strong>Packed Smart</strong>
          </span>
        </div>
      </header>
      <main className="auth-screen">
        {banner}
        {children}
      </main>
    </>
  );
}
