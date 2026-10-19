"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useHeadingFocus } from "./hooks";

/** The centered card every account screen sits in: eyebrow, focusable heading, then the content. */
export function AuthCard({
  titleId,
  title,
  headingRef,
  children,
  banner,
}: {
  titleId: string;
  title: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  children: ReactNode;
  banner?: ReactNode;
}) {
  // A screen that does not manage focus itself still puts it on the heading when it appears.
  const ownRef = useHeadingFocus(0);
  return (
    <main className="auth-screen">
      {banner}
      <Card as="section" padded className="auth-card" aria-labelledby={titleId}>
        <p className="eyebrow">Carrywell</p>
        <h1 id={titleId} ref={headingRef ?? ownRef} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </Card>
    </main>
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

/** Password input with the same show/hide toggle as sign-in (one fixed label, aria-pressed carries the state). */
export function PasswordField({
  id,
  name = "password",
  label,
  autoComplete,
  error,
  hint,
}: {
  id: string;
  name?: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  error?: string;
  hint?: string;
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
          required
        />
        <Button
          variant="secondary"
          small
          className="password-toggle"
          onClick={() => setShown((current) => !current)}
          aria-pressed={shown}
        >
          Show password
        </Button>
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
