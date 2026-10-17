import type { ReactNode } from "react";

export type StatusKind = "ready" | "remaining" | "draft";

// A glyph accompanies the text so state never relies on color alone.
const GLYPH: Record<StatusKind, string | null> = { ready: "✓", remaining: "○", draft: null };

export function StatusBadge({ status, children }: { status: StatusKind; children: ReactNode }) {
  const glyph = GLYPH[status];
  return (
    <span className={`status-pill ${status}`}>
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}
