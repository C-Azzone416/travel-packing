// Presentational sign-in card (design spec #31): a single centered card on Linen, "Welcome back", Email and
// Password (with show/hide), an inline error above the button, standard autocomplete attributes so password
// managers work, and a loading state that disables the form. #27 adds "Forgot password?", a link to create an
// account, and a status notice when the person arrives from the reset or verification screens.

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AuthShell } from "@/features/auth/AuthShell";
import { PasswordToggle } from "@/features/auth/AuthParts";
import { SIGN_IN_HINT_BEFORE } from "@/features/auth/copy";
import { useAuthPanelTop } from "@/features/auth/hooks";
import { INVALID_CREDENTIALS_MESSAGE } from "./state";

export interface SignInViewProps {
  action: (formData: FormData) => void;
  error: string | null;
  /** Random support reference matching the server log for this failed attempt. */
  reference?: string | null;
  pending: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  /** Optional decorative art above the card (must use alt="" so assistive tech ignores it). */
  banner?: ReactNode;
  /** A status message from a screen the person just came from ("Password updated…"). */
  notice?: string | null;
}

export function SignInView({
  action,
  error,
  reference,
  pending,
  showPassword,
  onTogglePassword,
  banner,
  notice,
}: SignInViewProps) {
  const card = useAuthPanelTop();
  return (
    <AuthShell banner={banner}>
      <section ref={card} className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Sign in</p>
        <h1 id="sign-in-title">Welcome back</h1>
        {notice && !error ? (
          <p className="auth-notice" role="status">
            <span aria-hidden="true">✓ </span>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="auth-error" role="alert">
            <span className="auth-error-message">
              <span aria-hidden="true">⚠ </span>
              {error}
            </span>
            {error === INVALID_CREDENTIALS_MESSAGE ? (
              <span className="auth-error-detail">
                {SIGN_IN_HINT_BEFORE}
                <Link className="auth-link inline-link" href="/forgot-password">
                  reset your password
                </Link>
                .
                {reference ? (
                  <span className="auth-reference"> Reference: {reference}.</span>
                ) : null}
              </span>
            ) : reference ? (
              <span className="auth-error-detail auth-reference">Reference: {reference}.</span>
            ) : null}
          </p>
        ) : null}
        <form className="auth-form" action={action} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              readOnly={pending}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-row">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                readOnly={pending}
              />
              <PasswordToggle shown={showPassword} onToggle={onTogglePassword} />
            </div>
          </div>
          <Button type="submit" block disabled={pending} aria-busy={pending}>
            {pending ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
        <div className="auth-link-row">
          <Link className="auth-link" href="/forgot-password">
            Forgot password?
          </Link>
          <Link className="auth-link" href="/sign-up">
            Create an account
          </Link>
        </div>
      </section>
    </AuthShell>
  );
}
