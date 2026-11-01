import { FeedbackReportHost } from "@/features/feedback/FeedbackReportHost";
import { useFeedbackTab } from "@/features/feedback/FeedbackAccess";
import { FeedbackTabItem } from "@/features/feedback/FeedbackTabItem";

/** The report host plus the tab-bar's Feedback item, as the shell mounts them (the host in AppShell, the item in Nav). */
export function FeedbackTabHarness() {
  const tab = useFeedbackTab();
  return (
    <>
      <FeedbackReportHost />
      {tab.enabled ? <FeedbackTabItem disabled={tab.disabled} onOpen={tab.open} /> : null}
    </>
  );
}
