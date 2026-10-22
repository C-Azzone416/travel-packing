// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateResolver } from "./DuplicateResolver";
import {
  allDecided,
  keptRows,
  type DuplicateChoices,
  type DuplicateGroupInput,
} from "./duplicates";

const groups: DuplicateGroupInput[] = [
  {
    key: "toothbrush",
    rows: [
      { id: "a", name: "Toothbrush", category: "Bathroom", qty: 1 },
      { id: "b", name: "Toothbrush", category: "Bathroom", qty: 2 },
    ],
  },
  {
    key: "socks",
    rows: [
      { id: "x", name: "Socks", category: "Clothing", qty: 1 },
      { id: "y", name: "Socks", category: "Clothing", qty: 2 },
      { id: "z", name: "Socks", category: "Clothing", qty: 3 },
    ],
  },
];

function Harness({ onDone }: { onDone?: (kept: string[]) => void }) {
  const [choices, setChoices] = useState<DuplicateChoices>({});
  return (
    <>
      <DuplicateResolver
        groups={groups}
        choices={choices}
        onChoose={(key, choice) => setChoices((current) => ({ ...current, [key]: choice }))}
        statusId="resolver-status"
      />
      <button
        type="button"
        disabled={!allDecided(groups, choices)}
        aria-describedby="resolver-status"
        onClick={() => onDone?.(keptRows(groups, choices).map((row) => row.id))}
      >
        Save list
      </button>
    </>
  );
}

describe("DuplicateResolver", () => {
  it("shows one named fieldset per group with its radios, and nothing selected", () => {
    render(<Harness />);
    const toothbrush = screen.getByRole("group", { name: "Toothbrush · Bathroom" });
    const radios = within(toothbrush).getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      within(toothbrush).getByRole("radio", { name: "Keep this one: Toothbrush · qty 1" }),
    ).toBeTruthy();
    expect(
      within(toothbrush).getByRole("radio", { name: "Keep this one: Toothbrush · qty 2" }),
    ).toBeTruthy();
    expect(within(toothbrush).getByRole("radio", { name: "Keep both (two rows)" })).toBeTruthy();
    const socks = screen.getByRole("group", { name: "Socks · Clothing" });
    expect(within(socks).getAllByRole("radio")).toHaveLength(4);
    expect(within(socks).getByRole("radio", { name: "Keep all (3 rows)" })).toBeTruthy();
    expect(
      screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(0);
  });

  it("keeps the primary button disabled and counting down until every group is decided", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const save = screen.getByRole("button", { name: "Save list" }) as HTMLButtonElement;
    const status = screen.getByRole("status");
    expect(status.id).toBe("resolver-status");
    expect(save.getAttribute("aria-describedby")).toBe("resolver-status");
    expect(save.disabled).toBe(true);
    expect(status.textContent).toBe("Choose one for each duplicate (2 left)");

    await user.click(screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 2" }));
    expect(status.textContent).toBe("Choose one for each duplicate (1 left)");
    expect(save.disabled).toBe(true);

    await user.click(screen.getByRole("radio", { name: "Keep all (3 rows)" }));
    expect(status.textContent).toBe("All duplicates decided.");
    expect(save.disabled).toBe(false);
  });

  it("is a polite live region", () => {
    render(<Harness />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("hands back exactly the chosen rows with their own quantities, never summed", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    await user.click(screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 2" }));
    await user.click(screen.getByRole("radio", { name: "Keep only: Socks · qty 3" }));
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(onDone).toHaveBeenCalledWith(["b", "z"]);
  });

  it("changing an answer replaces it, and Keep both keeps every row", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    await user.click(screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 1" }));
    await user.click(screen.getByRole("radio", { name: "Keep both (two rows)" }));
    await user.click(screen.getByRole("radio", { name: "Keep all (3 rows)" }));
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(onDone).toHaveBeenCalledWith(["a", "b", "x", "y", "z"]);
    const brush = screen.getByRole("group", { name: "Toothbrush · Bathroom" });
    expect(
      (
        within(brush).getByRole("radio", {
          name: "Keep this one: Toothbrush · qty 1",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("works from the keyboard: Tab reaches a group, arrows move within it, Space selects", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    const first = screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 1" });
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 2" }),
    );
    await user.keyboard(" ");
    expect(
      (screen.getByRole("radio", { name: "Keep this one: Toothbrush · qty 2" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Choose one for each duplicate (1 left)");
  });

  it("gives each group its own radio name, so choosing in one never clears another", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Keep both (two rows)" }));
    await user.click(screen.getByRole("radio", { name: "Keep only: Socks · qty 1" }));
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(2);
    const names = new Set(
      screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).name),
    );
    expect(names.size).toBe(2);
  });

  it("generates its own status id when none is given, and ignores a stale choice", () => {
    render(
      <DuplicateResolver
        groups={groups}
        choices={{ toothbrush: { kind: "only", rowId: "gone" } }}
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByRole("status").id).not.toBe("");
    expect(screen.getByRole("status").textContent).toBe("Choose one for each duplicate (2 left)");
    expect(
      screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(0);
  });

  it("names identical rows by where they came from, and uses a row's own keep label", () => {
    render(
      <DuplicateResolver
        groups={[
          {
            key: "hat",
            rows: [
              { id: "1", name: "Hat", category: "Accessories", qty: 1, source: "from Beach week" },
              { id: "2", name: "Hat", category: "Accessories", qty: 1, source: "on this trip" },
            ],
          },
          {
            key: "pen",
            rows: [
              { id: "3", name: "Pen", category: "Tech", qty: 1, keepLabel: "Keep the existing" },
              { id: "4", name: "Pen", category: "Tech", qty: 2, keepLabel: "Keep the new one" },
            ],
          },
        ]}
        choices={{}}
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByRole("radio", { name: "Keep the first: from Beach week" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Keep the second: on this trip" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Keep the existing: Pen · qty 1" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Keep the new one: Pen · qty 2" })).toBeTruthy();
  });
});
