"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AuthShell } from "./AuthShell";
import { useHeadingFocus } from "./hooks";

/** The card every account screen sits in, under the brand bar: a screen-name eyebrow, the focusable heading, then the content. */
export function AuthCard({
  titleId,
  eyebrow,
  title,
  headingRef,
  children,
  banner,
}: {
  titleId: string;
  /** What this screen is for ("Sign in", "Create account", ...), in place of the app name, which the brand bar carries. */
  eyebrow: string;
  title: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  children: ReactNode;
  banner?: ReactNode;
}) {
  // A screen that does not manage focus itself still puts it on the heading when it appears.
  const ownRef = useHeadingFocus(0);
  return (
    <AuthShell banner={banner}>
      <Card as="section" padded className="auth-card" aria-labelledby={titleId}>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={titleId} ref={headingRef ?? ownRef} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </Card>
    </AuthShell>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="auth-link" href={href}>
      {children}
    </Link>
  );
}

/** A labelled input with its problem underneath, joined by aria-describedby. */
export function TextField({
  id,
  name,
  label,
  error,
  hint,
  className,
  ...input
}: {
  id: string;
  name: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "className">) {
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        className={className}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-problem">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Show password" as a text toggle inside the field's right edge (link colour, a 44px target, aria-pressed). One fixed label:
 * a label that also flipped would read as contradictory next to aria-pressed.
 */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="password-toggle" onClick={onToggle} aria-pressed={shown}>
      Show password
    </button>
  );
}

/** Password input with the same show/hide toggle as sign-in (one fixed label, aria-pressed carries the state). */
export function PasswordField({
  id,
  name = "password",
  label,
  autoComplete,
  error,
  hint,
  modalAutoFocus = false,
}: {
  id: string;
  name?: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  error?: string;
  hint?: string;
  /** Ask ModalSheet to place initial focus on this input when the field is inside a dialog. */
  modalAutoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          data-modal-autofocus={modalAutoFocus ? "" : undefined}
          required
        />
        <PasswordToggle shown={shown} onToggle={() => setShown((current) => !current)} />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-problem">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The one form-level alert, above the button. */
export function FormAlert({ message }: { message: string | null }) {
  return message ? (
    <p className="auth-error" role="alert">
      <span aria-hidden="true">⚠ </span>
      {message}
    </p>
  ) : null;
}

/** Never disabled; after a noticeable wait it reads "Working…" and says it is busy. */
export function SubmitButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <Button type="submit" block aria-busy={busy}>
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" />
          Working…
        </>
      ) : (
        label
      )}
    </Button>
  );
}
