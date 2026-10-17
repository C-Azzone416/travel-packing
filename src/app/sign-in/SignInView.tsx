// Presentational sign-in card (design spec #31): a single centered card on Linen, "Welcome back", Email and
// Password (with show/hide), an inline error above the button, no sign-up link, standard autocomplete
// attributes so password managers work, and a loading state that disables the form.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export interface SignInViewProps {
  action: (formData: FormData) => void;
  error: string | null;
  pending: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  /** Optional decorative art above the card (must use alt="" so assistive tech ignores it). */
  banner?: ReactNode;
}

export function SignInView({
  action,
  error,
  pending,
  showPassword,
  onTogglePassword,
  banner,
}: SignInViewProps) {
  return (
    <main className="auth-screen">
      {banner}
      <Card as="section" padded className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Carrywell</p>
        <h1 id="sign-in-title">Welcome back</h1>
        <form className="auth-form" action={action} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={pending}
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
                disabled={pending}
              />
              <Button
                variant="secondary"
                small
                onClick={onTogglePassword}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide password" : "Show password"}
              </Button>
            </div>
          </div>

          {error ? (
            <p className="auth-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
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
      </Card>
    </main>
  );
}
