"use client";

import Link from "next/link";
import { LuggageTag } from "@/components/suitcase";
import { MoreMenu } from "@/components/ui/MoreMenu";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { upcomingRow } from "./home-view";
import styles from "./HomeUpcoming.module.css";

export interface HomeUpcomingActions {
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The trips after the next one as mini luggage tags (date, name, route), earliest first. Shared by both Homes (#388). With
 * `actions` each row gets the same ⋯ menu as the next trip's tag (Edit, Copy, Archive, Remove), so a later trip can be
 * managed without becoming the next one. The menu sits over the row, not in it: the tag clips what falls outside its shape.
 */
export function HomeUpcoming({
  trips,
  today,
  label,
  actions,
}: {
  trips: readonly LifecycleTrip[];
  today: string;
  label?: string;
  actions?: HomeUpcomingActions;
}) {
  return (
    <ul className={styles.upList} aria-label={label}>
      {trips.map((other) => {
        const row = upcomingRow(other, today);
        return (
          <li key={row.id} className={styles.item}>
            <Link className={styles.miniLink} href={`/trips/${row.id}`}>
              <LuggageTag variant="mini">
                <span className={styles.miniRow} data-menu={actions ? "true" : undefined}>
                  <span className={styles.miniDate}>{row.date}</span>
                  <span className={styles.miniName}>{row.name}</span>
                  <span className={styles.miniRoute}>{row.route}</span>
                </span>
              </LuggageTag>
            </Link>
            {actions ? (
              <div className={styles.menuSlot}>
                <MoreMenu
                  subject={row.name}
                  items={[
                    { key: "edit", label: "Edit trip", onSelect: () => actions.onEdit(row.id) },
                    { key: "copy", label: "Copy trip", href: `/trips/new?copy=${row.id}` },
                    {
                      key: "archive",
                      label: "Archive",
                      onSelect: () => actions.onArchive(row.id),
                    },
                    {
                      key: "remove",
                      label: "Remove",
                      danger: true,
                      onSelect: () => actions.onRemove(row.id),
                    },
                  ]}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
