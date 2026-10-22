// Presentational sign-in card (design spec #31): a single centered card on Linen, "Welcome back", Email and
// Password (with show/hide), an inline error above the button, standard autocomplete attributes so password
// managers work, and a loading state that disables the form. #27 adds "Forgot password?", a link to create an
// account, and a status notice when the person arrives from the reset or verification screens.

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SIGN_IN_HINT_BEFORE } from "@/features/auth/copy";
import { INVALID_CREDENTIALS_MESSAGE } from "./state";

export interface SignInViewProps {
  action: (formData: FormData) => void;
  error: string | null;
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
  pending,
  showPassword,
  onTogglePassword,
  banner,
  notice,
}: SignInViewProps) {
  return (
    <main className="auth-screen">
      {banner}
      <Card as="section" padded className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Carrywell</p>
        <h1 id="sign-in-title">Welcome back</h1>
        {notice ? (
          <p className="auth-notice" role="status">
            {notice}
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
              {/* One fixed label with aria-pressed: a label that also flips would read as contradictory. */}
              <Button
                variant="secondary"
                small
                className="password-toggle"
                onClick={onTogglePassword}
                aria-pressed={showPassword}
              >
                Show password
              </Button>
            </div>
            <Link className="auth-link forgot-link" href="/forgot-password">
              Forgot password?
            </Link>
          </div>

          {error ? (
            <p className="auth-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
              {error === INVALID_CREDENTIALS_MESSAGE ? (
                <>
                  {" "}
                  {SIGN_IN_HINT_BEFORE}
                  <Link className="auth-link inline-link" href="/forgot-password">
                    reset your password
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}

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
        <p className="auth-links">
          New here?{" "}
          <Link className="auth-link" href="/sign-up">
            Create an account
          </Link>
        </p>
      </Card>
    </main>
  );
}
