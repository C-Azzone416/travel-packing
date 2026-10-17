// Presentational sign-in card (design spec #31): centered card, "Welcome back", Email + Password with a
// show/hide toggle, inline error above the button, no sign-up link, standard autocomplete attributes.

import type { ReactNode } from "react";

export interface SignInViewProps {
  action: (formData: FormData) => void;
  error: string | null;
  pending: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  /** Reserved for the decorative art banner above the card (alt="" so it is ignored by assistive tech). */
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
      <section className="auth-card" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Welcome back</h1>
        <form action={action} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={pending}
          />

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
            <button type="button" onClick={onTogglePassword} aria-pressed={showPassword}>
              {showPassword ? "Hide password" : "Show password"}
            </button>
          </div>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
