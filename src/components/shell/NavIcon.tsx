import type { ReactNode } from "react";
import type { NavIconName } from "./nav-items";

// The five tab-bar icons (#300), all on one 24px grid: outline, stroke 2, round caps and joins, live area 3 to 21. The size comes
// from CSS (24px on phones, 20px in the 48px row layout, 16px inline in the desktop header), so there are no width/height attributes.
// Closed shapes carry `data-fill` so the active link can tint them (CSS) without tinting Feedback or Sign out.
export const NAV_ICON_SHAPES: Record<NavIconName | "signout" | "feedback", ReactNode> = {
  trips: (
    <>
      <rect data-fill x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M9 12v4M15 12v4" />
    </>
  ),
  staples: (
    <>
      <path data-fill d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle data-fill cx="15" cy="7" r="2" />
      <circle data-fill cx="9" cy="17" r="2" />
    </>
  ),
  signout: (
    <>
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="m16 8 4 4-4 4M20 12H9" />
    </>
  ),
  feedback: <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
};

export function NavIcon({ name }: { name: keyof typeof NAV_ICON_SHAPES }) {
  return (
    <span className="nav-glyph" aria-hidden="true">
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {NAV_ICON_SHAPES[name]}
      </svg>
    </span>
  );
}
