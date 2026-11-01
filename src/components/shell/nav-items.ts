export type NavIconName = "trips" | "staples" | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

// Exactly three destinations (#12). Trips is also the home route.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Trips", icon: "trips" },
  { href: "/staples", label: "Staples", icon: "staples" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/" || pathname.startsWith("/trips");
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
