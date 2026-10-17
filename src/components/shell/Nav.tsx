"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, NAV_ITEMS } from "./nav-items";

// Fixed bottom bar on phones, compact vertical rail from 900px (CSS only).
export function Nav() {
  const pathname = usePathname();
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
    </nav>
  );
}
