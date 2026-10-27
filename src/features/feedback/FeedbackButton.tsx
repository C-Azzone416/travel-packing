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
  const { available, status, scopeKey, subscribeReceipts, registerReportOpener } =
    useFeedbackAccess();
  const pathname = usePathname();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [open, setOpen] = useState<{
    n: number;
    scope: string | null;
    screenshot: TakenScreenshot | null;
  } | null>(null);
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

  // The Settings card's "Send feedback" opens this same sheet (#273): it asks through the provider, and this button does the opening,
  // so there is one flow, one receipt toast and one place that decides whether anything may be captured.
  const openRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    openRef.current = () => void openSheet();
  });
  useEffect(() => registerReportOpener(() => openRef.current()), [registerReportOpener]);

  // A sheet opened for one account is never shown to another: its unsent notes and screenshot go with the account.
  const sheet = open && open.scope === scopeKey ? open : null;

  if (!available || captureBlocked(pathname)) return null;

  async function openSheet() {
    // Both controls share one rule: nothing opens unless this person can send, on a screen where reports may be made at all.
    if (opening || sheet || !status?.canCapture || !available || captureBlocked(pathname)) return;
    setOpening(true);
    const taken = screenshotCaptureAvailable ? await captureScreenshot() : null;
    const screenshot: TakenScreenshot | null = taken
      ? taken.kind === "ok"
        ? { blob: taken.blob, reason: null }
        : { blob: null, reason: taken.kind }
      : null;
    opens.current += 1;
    setReceivedId(null);
    setOpen({ n: opens.current, scope: scopeKey, screenshot });
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
      {sheet ? (
        <FeedbackSheet
          key={sheet.n}
          pathname={pathname}
          screenshot={sheet.screenshot}
          receivedId={receivedId}
          onSaved={(id) => savedIds.current.add(id)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
