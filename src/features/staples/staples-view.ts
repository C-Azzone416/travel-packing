// Pure view logic for the Staples screen (#18). No React, no clock.

import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";

/** The four peer sections, in their fixed order (design's #18 gap 1). */
export const SECTIONS = ["Clothing", "Bathroom", "Tech", "Other essentials"] as const;
export type Section = (typeof SECTIONS)[number];

export type StapleFilter = "all" | "packlast";

const DESCRIPTIONS: Record<Section, string> = {
  Clothing: "Everyday pieces that seed every new trip.",
  Bathroom:
    "These appear as normal Toiletries checkboxes; bag placement stays a separate confirmation.",
  Tech: "Devices and their shared charging kit.",
  "Other essentials": "Recurring essentials for every new trip.",
};
export const sectionDescription = (section: Section): string => DESCRIPTIONS[section];

/** Which section a staple belongs in. Pack last is a timing flag, never a section of its own. */
export function sectionOf(staple: Pick<Staple, "category" | "groupId">): Section {
  if (staple.groupId === TOILETRY_GROUP_ID) return "Bathroom";
  switch (staple.category.trim().toLowerCase()) {
    case "clothing":
    case "clothes":
    case "nice attire":
      return "Clothing";
    case "bathroom":
    case "toiletries":
      return "Bathroom";
    case "tech":
    case "technology":
      return "Tech";
    default:
      return "Other essentials";
  }
}

export interface SectionView {
  section: Section;
  staples: Staple[];
}

/**
 * The sections to show. Under All every section is shown (an empty one says so); under Pack last, only sections that
 * have a Pack last staple.
 */
export function groupStaples(staples: readonly Staple[], filter: StapleFilter): SectionView[] {
  const visible = filter === "packlast" ? staples.filter((staple) => staple.packLast) : staples;
  return SECTIONS.map((section) => ({
    section,
    staples: visible.filter((staple) => sectionOf(staple) === section),
  })).filter((view) => filter === "all" || view.staples.length > 0);
}

export const countLabel = (count: number): string =>
  `${count} ${count === 1 ? "staple" : "staples"}`;

/** The staple that already has this name (ignoring case and surrounding space), other than `exceptId`. */
export function findDuplicate(
  staples: readonly Staple[],
  name: string,
  exceptId: string | null,
): Staple | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return staples.find(
    (staple) => staple.id !== exceptId && staple.name.trim().toLowerCase() === wanted,
  );
}

/** "2 per day" / "1 per trip". */
export const unitLabel = (staple: Pick<Staple, "qty" | "cadence">): string =>
  `${staple.qty} ${staple.cadence}`;

/**
 * The category to store for an edit. A staple keeps its stored category (for example "Nice attire") when the
 * chosen section is the one it is already in; choosing another section stores that section's name.
 */
export function categoryFor(current: string | null, section: Section): string {
  return current !== null && sectionOf({ category: current }) === section ? current : section;
}

/** A new staple's id: unique, never reused, and not derived from the name (names can be edited). */
export const newStapleId = (random: () => string = () => crypto.randomUUID()): string =>
  `staple-${random()}`;
