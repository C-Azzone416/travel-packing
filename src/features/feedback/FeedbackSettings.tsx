"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useFeedbackAccess, type ConnectResult, type DisconnectResult } from "./FeedbackAccess";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type ConnectFailure = Exclude<ConnectResult, { kind: "connected" }>;

/** What a failed Connect says. Each is true of what happened; none suggests the invitation was or was not spent when that is not known. */
export function connectFailureText(result: ConnectFailure): string {
  switch (result.kind) {
    case "invalid":
      return "That invitation didn’t work. It may have expired or already been used. Ask the developer for a new one.";
    case "uncertain":
      return "We couldn’t confirm the connection, and the invitation may have been used. Paste the same invitation again to finish. It won’t be spent twice.";
    case "offline":
      return "You’re offline. Connect again when you’re back online.";
    case "rate-limited":
      return result.retryAfterSeconds !== null
        ? `Too many tries. Wait ${result.retryAfterSeconds} ${result.retryAfterSeconds === 1 ? "second" : "seconds"} and try again.`
        : "Too many tries. Wait a little and try again.";
    case "unavailable":
      return "Feedback isn’t available right now. Try again later.";
  }
}

export const DISCONNECT_RESULT: Record<DisconnectResult, string> = {
  ended: "Disconnected. Your feedback access was ended.",
  nothing: "You weren’t connected, so there was nothing to end.",
  failed: "We couldn’t reach the service to end the access. You’re still connected. Try again.",
  offline: "You’re offline, so nothing was changed. Disconnect again when you’re back online.",
};

const STATE_TEXT = {
  needsReconnect:
    "Your saved feedback connection can’t be reopened. Add a new invitation to send feedback again.",
  expired: "Your feedback access has expired. Add a new invitation to send feedback again.",
  revoked: "Your feedback access was ended. Add a new invitation to send feedback again.",
  disabled:
    "Feedback is switched off for this app for now. Ask the developer when it will be back.",
  unavailable: "Feedback isn’t available right now. The rest of the app works as usual.",
  pending:
    "Connecting wasn’t finished. Paste the same invitation again to finish. It won’t be spent twice.",
} as const;

const BADGE = {
  needsReconnect: "Needs invitation",
  expired: "Expired",
  revoked: "Ended",
  disabled: "Switched off",
  unavailable: "Unavailable",
  pending: "Not finished",
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function expiryText(expiresAt: string | null): string | null {
  const date = expiresAt ? new Date(expiresAt) : null;
  return date && !Number.isNaN(date.getTime())
    ? `Feedback works until ${DATE.format(date)}.`
    : null;
}

// Settings > "Send feedback to the developer" (#131, design's #129 section 1; #260). The enrollment belongs to the signed-in
// account and lives on the server, so connecting once works on every device. The invitation lives only in the field until Connect
// is pressed (then it is cleared) and in the request; nothing here stores or logs it.
export function FeedbackSettings() {
  const { available, status, outbox, connect, disconnect, clearUnsent, openReport } =
    useFeedbackAccess();
  const toast = useToast();
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();
  const [invitation, setInvitation] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [disconnected, setDisconnected] = useState<string | null>(null);

  if (!available) return null;

  const connected = status?.connected === true;
  const connection = status?.connection ?? null;
  // A new invitation can fix these. "Switched off" and "unavailable" need the developer or time, so no form is offered for them.
  const canRedeem =
    connection === "not-connected" ||
    connection === "needs_reconnect" ||
    connection === "expired" ||
    connection === "revoked";
  const stateKey =
    status?.pendingRedemption === true
      ? "pending"
      : connection === "needs_reconnect"
        ? "needsReconnect"
        : connection === "expired" ||
            connection === "revoked" ||
            connection === "disabled" ||
            connection === "unavailable"
          ? connection
          : null;
  const expiry = connected ? expiryText(status?.expiresAt ?? null) : null;
  const unsent = outbox.waiting + outbox.blocked;

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
    if (result.kind === "connected") toast.show("Connected. Feedback is on.");
    else setFailure(connectFailureText(result));
  }

  async function confirmDisconnect() {
    setConfirming(false);
    setBusy(true);
    const result = await disconnect();
    setBusy(false);
    setDisconnected(DISCONNECT_RESULT[result]);
  }

  async function confirmClear() {
    setConfirmingClear(false);
    setBusy(true);
    await clearUnsent();
    setBusy(false);
    toast.show("Unsent reports deleted from this device.");
  }

  return (
    <Card as="section" padded id="settings-feedback" aria-labelledby="settings-feedback-title">
      <h2 id="settings-feedback-title">Send feedback to the developer</h2>
      <p>
        Connect with an invitation from the developer to send feedback from inside the app. Your
        connection belongs to your account, so it works on your other devices too. Nothing is sent
        until you press Send on a report.
      </p>
      {status === null ? (
        <p className="tiny muted" role="status" aria-busy="true">
          Checking your feedback access…
        </p>
      ) : connected ? (
        <div className="feedback-state">
          <StatusBadge status="ready">Connected</StatusBadge>
          {expiry ? <p className="tiny muted">{expiry}</p> : null}
        </div>
      ) : stateKey ? (
        <div className="feedback-state">
          <StatusBadge status="remaining">{BADGE[stateKey]}</StatusBadge>
          <p className="tiny muted">{STATE_TEXT[stateKey]}</p>
        </div>
      ) : null}
      {status && !status.online ? (
        <p className="tiny muted">
          You’re offline. Reports you save are kept on this device and sent when you’re back online.
        </p>
      ) : null}
      {status?.rateLimited ? (
        <p className="tiny muted">
          Feedback is limited for a moment. Reports wait on this device and send soon.
        </p>
      ) : null}
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
      {outbox.state === "storage-unavailable" ? (
        <p className="tiny muted">
          This browser can’t keep reports on the device, so feedback can’t be saved here.
        </p>
      ) : null}
      {disconnected ? (
        <p className="tiny" role="status">
          {disconnected}
        </p>
      ) : null}
      {connected && !confirming && !confirmingClear ? (
        // One row: Send feedback (the same sheet as the header button, shown only where that button is on), then Disconnect and, when
        // there are any, Delete unsent reports. On a phone Send feedback has the row to itself (#273, design's spec section 1).
        <div className="feedback-actions">
          {status?.canCapture ? (
            <Button className="feedback-send-action" disabled={busy} onClick={openReport}>
              Send feedback
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
          {unsent > 0 ? (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmingClear(true)}>
              Delete unsent reports
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div className="feedback-confirm" role="group" aria-label="Disconnect feedback">
          <p>
            Disconnect feedback? It ends your access on every device, and you’ll need a new
            invitation to connect again. Reports waiting to send stay on this device.
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
      {unsent > 0 && !confirmingClear && !(connected && !confirming) ? (
        <div className="feedback-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmingClear(true)}>
            Delete unsent reports
          </Button>
        </div>
      ) : null}
      {confirmingClear ? (
        <div className="feedback-confirm" role="group" aria-label="Delete unsent reports">
          <p>
            Delete {plural(unsent, "unsent report", "unsent reports")} from this device? They won’t
            be sent, and this can’t be undone.
          </p>
          <div className="feedback-actions">
            <Button variant="danger" onClick={confirmClear}>
              Delete
            </Button>
            <Button autoFocus variant="secondary" onClick={() => setConfirmingClear(false)}>
              Keep them
            </Button>
          </div>
        </div>
      ) : null}
      {canRedeem ? (
        // The invitation is memory-only and sits in a password field; the whole form is also kept out of any screenshot (#273).
        <form onSubmit={submit} className="feedback-form" data-feedback-exclude="invitation">
          <div className="field">
            <label htmlFor={fieldId}>Invitation</label>
            <input
              id={fieldId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={invitation}
              aria-invalid={failure ? true : undefined}
              aria-describedby={failure ? `${helpId} ${errorId}` : helpId}
              onChange={(event) => setInvitation(event.target.value)}
            />
            <p id={helpId} className="tiny muted">
              Paste the invitation the developer sent you. It works once and isn’t stored.
            </p>
            {failure ? (
              <p id={errorId} className="field-error" role="alert">
                <span aria-hidden="true">⚠ </span>
                {failure}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={busy || invitation.trim() === ""}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </form>
      ) : null}
      <p className="tiny muted">
        Feedback goes to the developer of this app. Don’t include passwords, codes or personal
        details.
      </p>
    </Card>
  );
}
