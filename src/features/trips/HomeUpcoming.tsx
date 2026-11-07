"use client";

import Link from "next/link";
import { LuggageTag } from "@/components/suitcase";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { upcomingRow } from "./home-view";
import styles from "./HomeUpcoming.module.css";

/** The trips after the next one as mini luggage tags (date, name, route), earliest first. Shared by both Homes (#388). */
export function HomeUpcoming({
  trips,
  today,
  label,
}: {
  trips: readonly LifecycleTrip[];
  today: string;
  label?: string;
}) {
  return (
    <ul className={styles.upList} aria-label={label}>
      {trips.map((other) => {
        const row = upcomingRow(other, today);
        return (
          <li key={row.id}>
            <Link className={styles.miniLink} href={`/trips/${row.id}`}>
              <LuggageTag variant="mini">
                <span className={styles.miniRow}>
                  <span className={styles.miniDate}>{row.date}</span>
                  <span className={styles.miniName}>{row.name}</span>
                  <span className={styles.miniRoute}>{row.route}</span>
                </span>
              </LuggageTag>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
