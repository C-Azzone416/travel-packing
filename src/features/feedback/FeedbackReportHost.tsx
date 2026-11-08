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

// The report flow (#132) without a button of its own (#293): the phone tab bar and the header's Feedback item open it through
// the provider's `openReport` (#131), as do the Settings card and the editor entry. It is mounted once in the shell, outside the
// sticky header. Nothing opens on a screen where nothing may be captured, or until the person is connected. When this build
// offers screenshots the screen is captured BEFORE the sheet opens, so the sheet is not in it.
export function FeedbackReportHost() {
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

  // A sheet opened for one account is never shown to another: its unsent notes and screenshot go with the account.
  const sheet = open && open.scope === scopeKey ? open : null;

  async function openSheet() {
    // Every entry point shares one rule: nothing opens unless this person can send, on a screen where reports may be made at all.
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

  // The Settings card's "Send feedback" opens this same sheet (#273): it asks through the provider, and this host does the opening,
  // so there is one flow, one receipt toast and one place that decides whether anything may be captured.
  const openRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    openRef.current = () => void openSheet();
  });
  useEffect(() => registerReportOpener(() => openRef.current()), [registerReportOpener]);

  // Nothing is shown on a screen where nothing may be captured (the sheet included), as the old button was.
  if (!available || captureBlocked(pathname)) return null;

  return sheet ? (
    <FeedbackSheet
      key={sheet.n}
      pathname={pathname}
      screenshot={sheet.screenshot}
      receivedId={receivedId}
      onSaved={(id) => savedIds.current.add(id)}
      onClose={() => setOpen(null)}
    />
  ) : null;
}
