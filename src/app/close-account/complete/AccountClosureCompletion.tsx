"use client";

import { useEffect, useRef } from "react";
import { AuthCard } from "@/features/auth/AuthParts";
import { consumeAccountClosureSignalAction } from "./actions";
import { runConfirmedAccountClosureClientCleanup } from "./client-cleanup";
import { finishAccountClosure } from "./finish";

const DESTINATION = "/sign-in?notice=account-closed";

export function AccountClosureCompletion() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void finishAccountClosure({
      consume: consumeAccountClosureSignalAction,
      cleanup: runConfirmedAccountClosureClientCleanup,
      navigate: () => window.location.replace(DESTINATION),
    }).catch(() => {
      // Navigation runs in finishAccountClosure's finally. Swallow only the now-irrelevant local/network failure.
    });
  }, []);

  return (
    <AuthCard
      titleId="account-closure-complete-title"
      eyebrow="Account closure"
      title="Finishing up"
    >
      <p role="status" aria-live="polite">
        Your account is closed. Clearing local account data, then taking you to sign in…
      </p>
      <noscript>
        <p>
          Local cleanup needs JavaScript. <a href={DESTINATION}>Continue to sign in</a>.
        </p>
      </noscript>
    </AuthCard>
  );
}
