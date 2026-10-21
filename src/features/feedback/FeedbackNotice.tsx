"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClassName } from "@/components/ui/Button";
import { useFeedbackAccess } from "./FeedbackAccess";

type Notice = NonNullable<ReturnType<typeof useFeedbackAccess>["status"]>["notice"];

const NOTICES: Record<NonNullable<Notice>, { text: string; action: string }> = {
  expired: {
    text: "Your feedback access has expired. Reports you save are kept on this device until you reconnect.",
    action: "Reconnect",
  },
  "access-required": {
    text: "Feedback needs a new invitation before it can send. Reports you save are kept on this device.",
    action: "Add invitation",
  },
  "connection-uncertain": {
    text: "We couldn’t confirm your feedback connection. Saved reports stay on this device and send once it’s confirmed.",
    action: "Check connection",
  },
  "migration-required": {
    text: "We found more than one feedback connection on this device. Add a new invitation to choose one. Saved reports are kept.",
    action: "Add invitation",
  },
};

const BLOCKED = {
  text: "Some feedback couldn’t be delivered. It’s kept on this device.",
  action: "See details",
};

// The strip under the app header when feedback needs attention (#131, design's #129 section 2). A notice from the
// access controller wins over undeliverable reports; neither shows on Settings, where the same facts are the section itself.
export function FeedbackNotice() {
  const { status, outbox } = useFeedbackAccess();
  const pathname = usePathname();
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return null;
  const message = status?.notice ? NOTICES[status.notice] : outbox.blocked > 0 ? BLOCKED : null;
  if (!message) return null;
  return (
    <div className="feedback-notice" role="status">
      <p>{message.text}</p>
      <Link
        className={buttonClassName({ variant: "secondary", small: true })}
        href="/settings#settings-feedback"
      >
        {message.action}
      </Link>
    </div>
  );
}
