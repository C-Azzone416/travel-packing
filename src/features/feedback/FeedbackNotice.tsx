"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClassName } from "@/components/ui/Button";
import { useFeedbackAccess } from "./FeedbackAccess";

type Notice = NonNullable<NonNullable<ReturnType<typeof useFeedbackAccess>["status"]>["notice"]>;

// Each says what is true and what the person can do. None blocks the app, and reports already saved stay on this device.
const NOTICES: Record<Notice, { text: string; action: string }> = {
  expired: {
    text: "Your feedback access has expired. Reports you saved are kept on this device until you reconnect.",
    action: "Reconnect",
  },
  revoked: {
    text: "Your feedback access was ended. Reports you saved are kept on this device. Add a new invitation to send them.",
    action: "Add invitation",
  },
  disabled: {
    text: "Feedback is switched off for now. Reports you saved are kept on this device.",
    action: "See details",
  },
  unavailable: {
    text: "Feedback isn’t available right now. Reports you saved are kept on this device.",
    action: "See details",
  },
  "finish-connecting": {
    text: "Feedback isn’t finished connecting. Paste the same invitation again to finish. It won’t be spent twice.",
    action: "Finish connecting",
  },
};

const BLOCKED = {
  text: "Some feedback couldn’t be delivered. It’s kept on this device.",
  action: "See details",
};

// The strip under the app header when feedback needs attention (#131, design's #129 section 2). A notice from the
// access controller wins over undeliverable reports; neither shows on Settings, where the same facts are the section itself.
export function FeedbackNotice() {
  const { available, status, outbox } = useFeedbackAccess();
  const pathname = usePathname();
  if (!available || pathname === "/settings" || pathname.startsWith("/settings/")) return null;
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
