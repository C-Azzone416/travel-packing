"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  captureScreenshot,
  screenshotCaptureAvailable,
} from "@/features/feedback/screenshot-capture";
import { captureBlocked } from "./capture-policy";
import { useFeedbackAccess } from "./FeedbackAccess";
import { COPY, FeedbackSheet, type TakenScreenshot } from "./FeedbackSheet";

// The header's Feedback entry point (#131, design's #129 section 3) and the report flow it opens (#132). It is absent on every
// screen where nothing may be captured (Settings and the sign-in and account screens), and disabled until the person is
// connected. When this build offers screenshots the screen is captured BEFORE the sheet opens, so the sheet is not in it.
export function FeedbackButton() {
  const { available, status, subscribeReceipts } = useFeedbackAccess();
  const pathname = usePathname();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [open, setOpen] = useState<{ n: number; screenshot: TakenScreenshot | null } | null>(null);
  const [receivedId, setReceivedId] = useState<string | null>(null);
  const opens = useRef(0);
  const sheetOpen = useRef(false);
  const savedIds = useRef(new Set<string>());
  useEffect(() => {
    sheetOpen.current = open !== null;
  }, [open]);

  // Received: shown in place while the sheet is open, otherwise as a toast.
  useEffect(
    () =>
      subscribeReceipts((id) => {
        setReceivedId(id);
        if (!sheetOpen.current && savedIds.current.has(id)) toast.show(COPY.receivedToast);
        savedIds.current.delete(id);
      }),
    [subscribeReceipts, toast],
  );

  if (!available || captureBlocked(pathname)) return null;

  async function openSheet() {
    if (opening || open) return;
    setOpening(true);
    const screenshot = screenshotCaptureAvailable ? { blob: await captureScreenshot() } : null;
    opens.current += 1;
    setReceivedId(null);
    setOpen({ n: opens.current, screenshot });
    setOpening(false);
  }

  return (
    <>
      <button
        type="button"
        className="button secondary small feedback-button"
        aria-label="Send feedback"
        disabled={!status?.canCapture || opening}
        onClick={openSheet}
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
      {open ? (
        <FeedbackSheet
          key={open.n}
          pathname={pathname}
          screenshot={open.screenshot}
          receivedId={receivedId}
          onSaved={(id) => savedIds.current.add(id)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
