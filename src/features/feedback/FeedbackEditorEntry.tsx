"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { captureBlocked } from "./capture-policy";
import { useFeedbackAccess } from "./FeedbackAccess";

// The Feedback entry inside the trip editor's header (#296, design's spec). The editor is a modal sheet, so while it is open the
// header's Feedback button is inert and covered. This calls the same `openReport` the Settings card uses: FeedbackButton stays the one
// place that decides whether anything may be captured, and it captures BEFORE its sheet mounts, so the picture shows this editor.
// Rendering, hovering or focusing this captures and sends nothing. `busy` disables it while the editor saves or applies.
export function FeedbackEditorEntry({ busy = false }: { busy?: boolean }) {
  const { available, status, openReport } = useFeedbackAccess();
  const pathname = usePathname();
  if (!available || captureBlocked(pathname)) return null;
  return (
    <Button
      variant="ghost"
      small
      className="feedback-editor-entry"
      data-feedback-editor-entry=""
      aria-label="Send feedback"
      disabled={busy || !status?.canCapture}
      onClick={openReport}
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
      <span className="feedback-entry-label">Feedback</span>
    </Button>
  );
}
