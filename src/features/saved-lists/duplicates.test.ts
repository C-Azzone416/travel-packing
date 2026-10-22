import { describe, expect, it } from "vitest";
import {
  allDecided,
  droppedRowIds,
  groupDuplicates,
  isValidChoice,
  keptRows,
  resolverOptions,
  resolverStatus,
  undecidedCount,
  type DuplicateGroupInput,
  type DuplicateRow,
} from "./duplicates";

const row = (
  id: string,
  name: string,
  qty: number,
  extra: Partial<DuplicateRow> = {},
): DuplicateRow => ({
  id,
  name,
  category: "Bathroom",
  qty,
  ...extra,
});

describe("groupDuplicates", () => {
  it("groups rows that share a normalised name and category, in first-seen order", () => {
    const groups = groupDuplicates([
      row("a", "Toothbrush", 1),
      row("b", "Socks", 4, { category: "Clothing" }),
      row("c", "  toothbrush ", 2),
      row("d", "Sock​s", 1, { category: "Clothing" }),
      row("e", "Toothbrush", 1, { category: "Tech" }),
    ]);
    expect(groups.map((group) => group.rows.map((r) => r.id))).toEqual([["a", "c"]]);
  });

  it("ignores accents and case, and keeps a different category apart", () => {
    const groups = groupDuplicates([
      row("a", "Crème", 1),
      row("b", "CREME", 2),
      row("c", "creme", 3, { category: "Clothing" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when no row repeats, and orders groups by their first member", () => {
    expect(groupDuplicates([row("a", "A", 1), row("b", "B", 1)])).toEqual([]);
    expect(groupDuplicates([])).toEqual([]);
    const groups = groupDuplicates([
      row("1", "B", 1),
      row("2", "A", 1),
      row("3", "A", 2),
      row("4", "B", 2),
    ]);
    expect(groups.map((group) => group.rows[0].name)).toEqual(["B", "A"]);
  });
});

const pair: DuplicateGroupInput = {
  key: "k1",
  rows: [row("a", "Toothbrush", 1), row("b", "Toothbrush", 2)],
};
const trio: DuplicateGroupInput = {
  key: "k2",
  rows: [row("x", "Socks", 1), row("y", "Socks", 2), row("z", "Socks", 3)],
};

describe("choices", () => {
  it("count a group as undecided until it has a valid answer (nothing is ever defaulted)", () => {
    expect(undecidedCount([pair, trio], {})).toBe(2);
    expect(undecidedCount([pair, trio], { k1: { kind: "all" } })).toBe(1);
    expect(
      allDecided([pair, trio], { k1: { kind: "all" }, k2: { kind: "only", rowId: "y" } }),
    ).toBe(true);
    expect(allDecided([], {})).toBe(true);
  });

  it("treat a stale choice (a row that is not in the group) as undecided", () => {
    expect(isValidChoice(pair, { kind: "only", rowId: "zzz" })).toBe(false);
    expect(isValidChoice(pair, undefined)).toBe(false);
    expect(isValidChoice(pair, { kind: "only", rowId: "b" })).toBe(true);
    expect(isValidChoice(pair, { kind: "all" })).toBe(true);
    expect(undecidedCount([pair], { k1: { kind: "only", rowId: "zzz" } })).toBe(1);
  });
});

describe("keptRows and droppedRowIds", () => {
  it("keep the chosen row with its own quantity, or every row, never summing", () => {
    const kept = keptRows([pair, trio], { k1: { kind: "only", rowId: "b" }, k2: { kind: "all" } });
    expect(kept.map((r) => [r.id, r.qty])).toEqual([
      ["b", 2],
      ["x", 1],
      ["y", 2],
      ["z", 3],
    ]);
    expect(kept.reduce((sum, r) => sum + r.qty, 0)).toBe(8);
  });

  it("name exactly the rows a choice drops", () => {
    expect(
      droppedRowIds([pair, trio], {
        k1: { kind: "only", rowId: "a" },
        k2: { kind: "only", rowId: "z" },
      }),
    ).toEqual(["b", "x", "y"]);
    expect(droppedRowIds([pair], { k1: { kind: "all" } })).toEqual([]);
  });

  it("throw rather than guess when a group is undecided or its choice is stale", () => {
    expect(() => keptRows([pair], {})).toThrow(/no valid choice/);
    expect(() => keptRows([pair], { k1: { kind: "only", rowId: "nope" } })).toThrow(
      /no valid choice/,
    );
    expect(() => droppedRowIds([pair], {})).toThrow();
  });
});

describe("resolverOptions", () => {
  it("two different rows: 'Keep this one:' for each, then 'Keep both (two rows)'", () => {
    expect(resolverOptions(pair).map((o) => [o.title, o.detail])).toEqual([
      ["Keep this one:", "Toothbrush · qty 1"],
      ["Keep this one:", "Toothbrush · qty 2"],
      ["Keep both", "(two rows)"],
    ]);
  });

  it("two identical rows: 'Keep the first/second:' with where each came from, else its position", () => {
    const withSource: DuplicateGroupInput = {
      key: "k",
      rows: [
        row("a", "Hat", 1, { source: "from Beach week" }),
        row("b", "Hat", 1, { source: "on this trip" }),
      ],
    };
    expect(resolverOptions(withSource).map((o) => [o.title, o.detail])).toEqual([
      ["Keep the first:", "from Beach week"],
      ["Keep the second:", "on this trip"],
      ["Keep both", "(two rows)"],
    ]);
    const plain: DuplicateGroupInput = { key: "k", rows: [row("a", "Hat", 1), row("b", "Hat", 1)] };
    expect(resolverOptions(plain)[0]).toMatchObject({
      title: "Keep the first:",
      detail: "row 1 of 2",
    });
  });

  it("uses a row's own keep label, as the editor and the apply-time check do", () => {
    const labelled: DuplicateGroupInput = {
      key: "k",
      rows: [
        row("a", "Toothbrush", 1, { keepLabel: "Keep the existing" }),
        row("b", "Toothbrush", 2, { keepLabel: "Keep the new one" }),
      ],
    };
    expect(resolverOptions(labelled).map((o) => o.title)).toEqual([
      "Keep the existing:",
      "Keep the new one:",
      "Keep both",
    ]);
  });

  it("three or more rows: 'Keep only:' for each plus 'Keep all (n rows)', and ordinals run on for identical rows", () => {
    expect(resolverOptions(trio).map((o) => [o.title, o.detail])).toEqual([
      ["Keep only:", "Socks · qty 1"],
      ["Keep only:", "Socks · qty 2"],
      ["Keep only:", "Socks · qty 3"],
      ["Keep all (3 rows)", ""],
    ]);
    const identical: DuplicateGroupInput = {
      key: "k",
      rows: Array.from({ length: 10 }, (_, at) => row(`r${at}`, "Pin", 1)),
    };
    const titles = resolverOptions(identical).map((o) => o.title);
    expect(titles[2]).toBe("Keep the third:");
    expect(titles[9]).toBe("Keep the #10:");
    expect(titles[10]).toBe("Keep all (10 rows)");
  });
});

describe("resolverStatus", () => {
  it("counts down the groups left, then says they are all decided", () => {
    expect(resolverStatus([pair, trio], {})).toBe("Choose one for each duplicate (2 left)");
    expect(resolverStatus([pair, trio], { k1: { kind: "all" } })).toBe(
      "Choose one for each duplicate (1 left)",
    );
    expect(resolverStatus([pair, trio], { k1: { kind: "all" }, k2: { kind: "all" } })).toBe(
      "All duplicates decided.",
    );
  });
});
