import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { AuthCard, AuthLink } from "./AuthParts";

/** A reset link that is missing, wrong, expired or already used: one screen for all of them, no form. */
export function InvalidLinkView() {
  return (
    <AuthCard titleId="invalid-link-title" eyebrow="Link problem" title="This link isn’t valid">
      <p className="auth-helper">It may have expired or already been used. Request a new one.</p>
      <Link className={buttonClassName({ block: true })} href="/forgot-password">
        Send a new reset link
      </Link>
      <p className="auth-links">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </AuthCard>
  );
}
