"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useFeedbackAccess, type ConnectResult } from "./FeedbackAccess";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export const CONNECT_FAILURE: Record<Exclude<ConnectResult, "connected">, string> = {
  invalid:
    "That invitation didn’t work. It may have expired or already been used. Ask the developer for a new one.",
  offline: "You’re offline. Connect again when you’re back online.",
  uncertain:
    "We couldn’t confirm the connection. Check the status above before trying again. Pasting the same invitation twice may not work.",
};

const NOTICE_BADGE = {
  expired: "Expired",
  "access-required": "Needs invitation",
  "migration-required": "Needs invitation",
  "connection-uncertain": "Not confirmed",
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function expiryText(expiresAt: string | null): string | null {
  const date = expiresAt ? new Date(expiresAt) : null;
  return date && !Number.isNaN(date.getTime())
    ? `Feedback works until ${DATE.format(date)}.`
    : null;
}

// Settings > "Send feedback to the developer" (#131, design's #129 section 1). The invitation lives only in the field
// until Connect is pressed (then it is cleared) and in the SDK call; nothing here stores or logs it.
export function FeedbackSettings() {
  const { available, status, outbox, connect, disconnect } = useFeedbackAccess();
  const toast = useToast();
  const fieldId = useId();
  const helpId = useId();
  const [invitation, setInvitation] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [disconnected, setDisconnected] = useState<string | null>(null);

  if (!available) return null;

  const connected = status?.connected === true;
  const showForm = !connected || replacing;
  const noticeBadge = status?.notice ? NOTICE_BADGE[status.notice] : null;
  const expiry = connected ? expiryText(status?.expiresAt ?? null) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = invitation.trim();
    if (!value || busy) return;
    setInvitation("");
    setFailure(null);
    setDisconnected(null);
    setBusy(true);
    const result = await connect(value);
    setBusy(false);
    if (result === "connected") {
      setReplacing(false);
      toast.show("Connected. Feedback is on.");
    } else {
      setFailure(CONNECT_FAILURE[result]);
    }
  }

  async function confirmDisconnect() {
    setConfirming(false);
    setBusy(true);
    const result = await disconnect();
    setBusy(false);
    setReplacing(false);
    setDisconnected(
      result === "ended"
        ? "Disconnected. Feedback access was removed from this device and ended."
        : "Disconnected on this device. We couldn’t reach the service to end the access, so it may stay valid until it expires. Ask the developer to revoke it if you want it ended sooner.",
    );
  }

  return (
    <Card as="section" padded id="settings-feedback" aria-labelledby="settings-feedback-title">
      <h2 id="settings-feedback-title">Send feedback to the developer</h2>
      <p>
        Connect with an invitation from the developer to send feedback from inside the app. Nothing
        is sent until you press Send on a report.
      </p>
      {connected ? (
        <div className="feedback-state">
          <StatusBadge status="ready">Connected</StatusBadge>
          {expiry ? <p className="tiny muted">{expiry}</p> : null}
          {outbox.waiting > 0 ? (
            <p className="tiny muted">
              {plural(outbox.waiting, "report", "reports")} waiting to send on this device.
            </p>
          ) : null}
          {outbox.blocked > 0 ? (
            <p className="tiny muted">
              {outbox.blocked} couldn’t be delivered. They are kept on this device.
            </p>
          ) : null}
        </div>
      ) : noticeBadge ? (
        <div className="feedback-state">
          <StatusBadge status="remaining">{noticeBadge}</StatusBadge>
        </div>
      ) : null}
      {disconnected ? (
        <p className="tiny" role="status">
          {disconnected}
        </p>
      ) : null}
      {connected && !confirming ? (
        <div className="feedback-actions">
          <Button
            variant="secondary"
            aria-expanded={replacing}
            onClick={() => setReplacing(!replacing)}
          >
            Use a new invitation
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        </div>
      ) : null}
      {confirming ? (
        <div className="feedback-confirm" role="group" aria-label="Disconnect feedback">
          <p>
            Disconnect feedback? You’ll need a new invitation to connect again. Reports waiting to
            send stay on this device.
          </p>
          <div className="feedback-actions">
            <Button variant="danger" onClick={confirmDisconnect}>
              Disconnect
            </Button>
            <Button autoFocus variant="secondary" onClick={() => setConfirming(false)}>
              Keep connected
            </Button>
          </div>
        </div>
      ) : null}
      {showForm ? (
        <form onSubmit={submit} className="feedback-form">
          <label htmlFor={fieldId}>Invitation</label>
          <input
            id={fieldId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={invitation}
            aria-describedby={helpId}
            onChange={(event) => setInvitation(event.target.value)}
          />
          <p id={helpId} className="tiny muted">
            Paste the invitation the developer sent you. It works once and isn’t stored.
          </p>
          <Button type="submit" disabled={busy || invitation.trim() === ""}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}
        </form>
      ) : null}
      <p className="tiny muted">
        Feedback goes to the developer of this app. Don’t include passwords, codes or personal
        details.
      </p>
    </Card>
  );
}
