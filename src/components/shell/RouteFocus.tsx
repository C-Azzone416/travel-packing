"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// On a client-side route change, move focus to <main> so keyboard and screen
// reader users land on the new screen. Skips the initial load.
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById("main")?.focus();
  }, [pathname]);
  return null;
}
