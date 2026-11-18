"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A direct phone-Home action. Other screens and the laptop header keep their existing navigation. */
export function HomeNewTripLink() {
  if (usePathname() !== "/") return null;
  return (
    <Link className="home-new-trip" href="/trips/new" aria-label="New trip">
      <span aria-hidden="true">＋</span>
      <span className="home-new-trip-label" aria-hidden="true">
        New trip
      </span>
      <span className="home-new-trip-label-short" aria-hidden="true">
        New
      </span>
    </Link>
  );
}
