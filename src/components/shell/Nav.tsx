"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, NAV_ITEMS } from "./nav-items";
import { useSignOut } from "./use-sign-out";

export interface NavProps {
  /** The sign-out server action. With the signed-in address it adds a "Sign out" item after the links (#117). */
  signOut?: () => Promise<void>;
  /** The signed-in address: only the button's tooltip ("Signed in as …"), never visible text (the rail is 82px wide). */
  email?: string | null;
}

// Arrow leaving a bracket, drawn here (a font glyph can show as a box or an emoji). Same 18px as the other glyphs.
function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="m16 8 4 4-4 4M20 12H9" />
    </svg>
  );
}

// Fixed bottom bar on phones, compact vertical rail from 900px (CSS only).
export function Nav({ signOut, email }: NavProps = {}) {
  const pathname = usePathname();
  const signOutAndClear = useSignOut(signOut);
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item, pathname) ? "page" : undefined}
        >
          <span aria-hidden="true">{item.glyph}</span>
          {item.label}
        </Link>
      ))}
      {signOut && email ? (
        // One tap, no confirm, as on Settings. Never the current page, so no aria-current.
        <form action={signOutAndClear} className="nav-signout">
          <button type="submit" tabIndex={0} title={`Signed in as ${email}`}>
            <span aria-hidden="true">
              <SignOutIcon />
            </span>
            Sign out
          </button>
        </form>
      ) : null}
    </nav>
  );
}
