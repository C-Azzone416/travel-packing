export interface NavItem {
  href: string;
  label: string;
  glyph: string;
}

// Exactly three destinations (#12). Trips is also the home route.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Trips", glyph: "⌂" },
  { href: "/staples", label: "Staples", glyph: "◇" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/" || pathname.startsWith("/trips");
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
