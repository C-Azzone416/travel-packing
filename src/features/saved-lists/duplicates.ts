// Pure logic for the shared DuplicateResolver (#168, #140 spec §0). A group is the rows that share a normalised name and
// category; the person decides each group, and nothing is ever defaulted, merged or summed: a kept row keeps its own
// quantity, exactly as it was.

import { duplicateKey } from "@/domain/saved-lists";

export interface DuplicateRow {
  /** Stable identity of the row, unique across all groups. */
  id: string;
  name: string;
  category: string;
  qty: number;
  /** Where it came from ("from Beach week", "on this trip"). Used only to tell identical rows apart. */
  source?: string;
  /** Names this row's "keep" option in place of "Keep this one" ("Keep the existing", "Keep the one on the trip"). */
  keepLabel?: string;
}

export interface DuplicateGroupInput {
  /** The normalised name and category the rows share. */
  key: string;
  rows: readonly DuplicateRow[];
}

/** Keep exactly one row of the group, or every row of it. */
export type DuplicateChoice = { kind: "only"; rowId: string } | { kind: "all" };

/** The choices so far, by group key. A missing key is a group nobody has decided yet. */
export type DuplicateChoices = Readonly<Record<string, DuplicateChoice | undefined>>;

/** Groups of two or more rows with the same normalised name and category, in the order each key first appears. */
export function groupDuplicates(rows: readonly DuplicateRow[]): DuplicateGroupInput[] {
  const byKey = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    const key = duplicateKey(row.name, row.category);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey]
    .filter(([, members]) => members.length >= 2)
    .map(([key, members]) => ({ key, rows: members }));
}

/** Whether a choice is a valid answer for the group: a row that is in it, or "all". */
export function isValidChoice(
  group: DuplicateGroupInput,
  choice: DuplicateChoice | undefined,
): boolean {
  if (!choice) return false;
  return choice.kind === "all" || group.rows.some((row) => row.id === choice.rowId);
}

/** How many groups still need an answer. A stale or invalid choice counts as undecided. */
export function undecidedCount(
  groups: readonly DuplicateGroupInput[],
  choices: DuplicateChoices,
): number {
  return groups.filter((group) => !isValidChoice(group, choices[group.key])).length;
}

export const allDecided = (
  groups: readonly DuplicateGroupInput[],
  choices: DuplicateChoices,
): boolean => undecidedCount(groups, choices) === 0;

/**
 * The rows to keep from every group, in group and row order. Throws when a group is undecided: callers must check
 * `allDecided` first, because there is no safe default to fall back on.
 */
export function keptRows(
  groups: readonly DuplicateGroupInput[],
  choices: DuplicateChoices,
): DuplicateRow[] {
  const kept: DuplicateRow[] = [];
  for (const group of groups) {
    const choice = choices[group.key];
    if (!choice || !isValidChoice(group, choice))
      throw new Error(`Duplicate group "${group.key}" has no valid choice`);
    kept.push(
      ...(choice.kind === "all" ? group.rows : group.rows.filter((row) => row.id === choice.rowId)),
    );
  }
  return kept;
}

/** The ids of the rows a choice drops, so a caller can remove exactly those. */
export function droppedRowIds(
  groups: readonly DuplicateGroupInput[],
  choices: DuplicateChoices,
): string[] {
  const kept = new Set(keptRows(groups, choices).map((row) => row.id));
  return groups.flatMap((group) => group.rows.map((row) => row.id)).filter((id) => !kept.has(id));
}

const sameRow = (a: DuplicateRow, b: DuplicateRow): boolean =>
  a.name === b.name && a.category === b.category && a.qty === b.qty;

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
];

export interface ResolverOption {
  /** "only" keeps that one row; "all" keeps every row. */
  choice: DuplicateChoice;
  /** The option's lead text: "Keep this one:", "Keep the first:", "Keep both". */
  title: string;
  /** What it keeps: "Toothbrush · qty 2", where the row came from when the rows read the same, or "(two rows)". */
  detail: string;
}

const countWord = (n: number): string => (n === 2 ? "two" : String(n));

/**
 * The radio options for a group, in row order, with "keep all" last. Two rows read "Keep this one: Toothbrush · qty 1"
 * (or the row's own keepLabel); when the rows are identical to the eye they read "Keep the first/second: from Beach
 * week"; three or more read "Keep only: …" and "Keep all (n rows)".
 */
export function resolverOptions(group: DuplicateGroupInput): ResolverOption[] {
  const { rows } = group;
  const identical = rows.every((row) => sameRow(row, rows[0]));
  const options: ResolverOption[] = rows.map((row, at) => {
    const choice: DuplicateChoice = { kind: "only", rowId: row.id };
    const description = `${row.name} · qty ${row.qty}`;
    if (row.keepLabel) return { choice, title: `${row.keepLabel}:`, detail: description };
    if (identical) {
      const ordinal = ORDINALS[at] ?? `#${at + 1}`;
      return {
        choice,
        title: `Keep the ${ordinal}:`,
        detail: row.source ?? `row ${at + 1} of ${rows.length}`,
      };
    }
    return {
      choice,
      title: rows.length === 2 ? "Keep this one:" : "Keep only:",
      detail: description,
    };
  });
  options.push({
    choice: { kind: "all" },
    title: rows.length === 2 ? "Keep both" : `Keep all (${rows.length} rows)`,
    detail: rows.length === 2 ? `(${countWord(rows.length)} rows)` : "",
  });
  return options;
}

/** The status line the primary button points at: "Choose one for each duplicate (2 left)". */
export function resolverStatus(
  groups: readonly DuplicateGroupInput[],
  choices: DuplicateChoices,
): string {
  const left = undecidedCount(groups, choices);
  if (left === 0) return "All duplicates decided.";
  return `Choose one for each duplicate (${left} left)`;
}
