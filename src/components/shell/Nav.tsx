"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeedbackTab } from "@/features/feedback/FeedbackAccess";
import { FeedbackTabItem } from "@/features/feedback/FeedbackTabItem";
import { NavIcon } from "./NavIcon";
import { isActive, NAV_ITEMS } from "./nav-items";
import { useSignOut } from "./use-sign-out";

export interface NavProps {
  /** The sign-out server action. With the signed-in address it adds a "Sign out" item after the links (#117). */
  signOut?: () => Promise<void>;
  /** The signed-in address: only the button's tooltip ("Signed in as …"), never visible text (the rail is 82px wide). */
  email?: string | null;
}

// Fixed bottom bar on phones, inline in the header from 721px (CSS only). Phones have four slots: the three links, then Feedback
// when feedback is on for this person (#293), otherwise Sign out (which also lives in Settings). From 721px the header keeps both.
export function Nav({ signOut, email }: NavProps = {}) {
  const pathname = usePathname();
  const signOutGuard = useSignOut(signOut);
  const feedback = useFeedbackTab();
  const signedIn = Boolean(signOut && email);
  const signOutForm = (wide: boolean) => (
    // One tap with nothing unsent; with unsent feedback the warning sheet opens first (#325). Never the current page.
    <form
      action={signOutGuard.action}
      className={wide ? "nav-signout nav-signout-wide" : "nav-signout"}
    >
      <button type="submit" tabIndex={0} title={`Signed in as ${email}`}>
        <NavIcon name="signout" />
        <span className="nav-label">Sign out</span>
      </button>
    </form>
  );
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item, pathname) ? "page" : undefined}
        >
          <NavIcon name={item.icon} />
          <span className="nav-label">{item.label}</span>
        </Link>
      ))}
      {signedIn && feedback.enabled ? (
        <>
          <FeedbackTabItem disabled={feedback.disabled} onOpen={feedback.open} />
          {signOutForm(true)}
        </>
      ) : null}
      {signedIn && !feedback.enabled ? signOutForm(false) : null}
      {signedIn ? signOutGuard.sheet : null}
    </nav>
  );
}
