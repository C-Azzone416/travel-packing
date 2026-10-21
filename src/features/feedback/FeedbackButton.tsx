"use client";

import { usePathname } from "next/navigation";
import { useFeedbackAccess } from "./FeedbackAccess";

// The header's Feedback entry point (#131, design's #129 section 3). It is present everywhere except Settings, and
// disabled until the person is connected; the report flow it opens arrives with #132.
export function FeedbackButton() {
  const { status } = useFeedbackAccess();
  const pathname = usePathname();
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return null;
  return (
    <button
      type="button"
      className="button secondary small feedback-button"
      aria-label="Send feedback"
      disabled={!status?.canCapture}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span className="feedback-button-label">Feedback</span>
    </button>
  );
}
