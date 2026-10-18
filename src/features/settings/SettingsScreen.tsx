"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSaveStatus } from "@/components/shell/SaveStatus";

export interface SettingsScreenProps {
  /** The signed-in account, read on the server. Null only if the session vanished mid-request. */
  email: string | null;
  /** The sign-out form action (a server action; sign out goes straight through, with no confirm). */
  signOut: () => Promise<void>;
}

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** "Last saved 3:42 PM". Shown only after a real write; before one there is nothing to report. */
export function lastSavedText(savedAt: Date): string {
  return `Last saved ${TIME.format(savedAt)}`;
}

// Settings (#19, design's #31): Account, then Save status. No Data section until export/import (#24) exists, and no
// simulated-sync or sample-data controls: saving is real, and the state shown is derived from what the server said.
export function SettingsScreen({ email, signOut }: SettingsScreenProps) {
  const { status, lastSavedAt, retry } = useSaveStatus();
  return (
    <section className="screen">
      <div className="page-head">
        <div className="head-copy">
          <p className="eyebrow">Settings</p>
          <h1>Settings</h1>
          <p className="muted">Your account and how saving is going.</p>
        </div>
      </div>
      <div className="settings-grid">
        <Card as="section" padded aria-labelledby="settings-account">
          <h2 id="settings-account">Account</h2>
          {email ? (
            <p>
              Signed in as <strong>{email}</strong>
            </p>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </Card>
        <Card as="section" padded aria-labelledby="settings-save">
          <h2 id="settings-save">Save status</h2>
          {status === "error" ? (
            <>
              <p>Your last change hasn’t been saved. We’ll keep it on screen while you retry.</p>
              <Button onClick={retry}>Retry</Button>
            </>
          ) : status === "saving" ? (
            <p>Saving…</p>
          ) : lastSavedAt ? (
            <p>Everything you changed is saved.</p>
          ) : (
            <p>No changes yet this visit. Changes you make are saved as you go.</p>
          )}
          {lastSavedAt ? (
            <p className="tiny muted" role="status">
              {lastSavedText(lastSavedAt)}
            </p>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
