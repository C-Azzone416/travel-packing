export type NavIconName = "trips" | "staples" | "settings";

export interface NavItem {
  href: string;
  label: string;
  /** The tab-bar icon. Stamps has none: it is a top-menu link only (the phone reaches it from Home, #391). */
  icon?: NavIconName;
  /** Shown in the laptop top menu (1024px and up) only, not as a phone tab. */
  laptopOnly?: boolean;
}

// Trips, Staples and Settings are the three phone tabs (#12); Stamps joins them in the laptop top menu (#383).
// Trips is also the home route.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Trips", icon: "trips" },
  { href: "/staples", label: "Staples", icon: "staples" },
  { href: "/stamps", label: "Stamps", laptopOnly: true },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/" || pathname.startsWith("/trips");
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
