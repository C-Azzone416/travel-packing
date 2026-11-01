"use client";

import { NavIcon } from "@/components/shell/NavIcon";

// The Feedback item in the phone tab bar's 4th slot, and in the desktop header's right cluster (#293). It lives here, not in Nav,
// so its copy ("Send feedback report", "Feedback", "Report") is only in builds that include feedback (hosted builds alias this
// module to feedback.disabled.tsx). The visible label is "Feedback", or "Report" when the bar is too narrow for it (CSS, container
// query on the bar); exactly one of the two spans is displayed, the other is display:none, so neither is read twice.
export function FeedbackTabItem({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="nav-feedback"
      aria-label="Send feedback report"
      disabled={disabled}
      onClick={onOpen}
    >
      <NavIcon name="feedback" />
      <span className="nav-label">
        <span className="nav-label-long">Feedback</span>
        <span className="nav-label-short" aria-hidden="true">
          Report
        </span>
      </span>
    </button>
  );
}
