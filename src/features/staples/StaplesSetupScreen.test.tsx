// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STAPLE_SUGGESTIONS, type StaplesSetup } from "@/domain/staples-setup";
import type { Staple } from "@/domain/trip";
import { StaplesSetupScreen } from "./StaplesSetupScreen";

const setup: StaplesSetup = { state: "incomplete", reminderDismissed: false, staples: [] };

describe("StaplesSetupScreen", () => {
  it("starts with every neutral suggestion unselected and can save an intentional empty list", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<StaplesSetupScreen setup={setup} busy={false} onSave={save} onSkip={vi.fn()} />);
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(
      screen.getByRole("checkbox", { name: "Underwear" }).nextElementSibling?.classList,
    ).toContain("save-list-box");
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    expect(save).toHaveBeenCalledWith([]);
  });

  it("shows a retry action without clearing the local checklist after a save error", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const { rerender } = render(
      <StaplesSetupScreen setup={setup} busy={false} onSave={save} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
    rerender(
      <StaplesSetupScreen setup={setup} busy={false} saveError onSave={save} onSkip={vi.fn()} />,
    );
    expect((screen.getByRole("checkbox", { name: "Underwear" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain("Your selections are still here");
    await user.click(screen.getByRole("button", { name: "Try save again" }));
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "underwear" })]);
  });

  it("selects only chosen suggestions and edits cadence, placement, and Pack last independently", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<StaplesSetupScreen setup={setup} busy={false} onSave={save} onSkip={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
    await user.click(screen.getByRole("button", { name: /^Edit / }));
    const dialog = screen.getByRole("dialog", { name: "Edit staple" });
    await user.click(within(dialog).getByRole("radio", { name: /^Smart/ }));
    await user.click(within(dialog).getByRole("radio", { name: /^Toiletry bag/ }));
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
    await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
    await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "underwear",
        category: "Clothing",
        cadence: "smart",
        groupId: "toiletry-bag",
        packLast: true,
      }),
    ]);
  });

  it("adds, edits, and removes a custom item before committing", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<StaplesSetupScreen setup={setup} busy={false} onSave={save} onSkip={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Custom item/ }));
    const add = screen.getByRole("dialog", { name: "Add a staple" });
    await user.type(within(add).getByLabelText("Item name"), "Notebook");
    await user.click(within(add).getByRole("button", { name: "Add staple" }));
    await user.click(screen.getByRole("button", { name: /^Edit / }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove staple" }),
    );
    await waitFor(() => expect(screen.queryByText("Your custom items")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    expect(save).toHaveBeenCalledWith([]);
  });

  describe("quantity rule summary (#355)", () => {
    const suggestion = (id: string): Staple =>
      STAPLE_SUGGESTIONS.find(({ staple }) => staple.id === id)!.staple;
    const renderSetup = (initial: StaplesSetup = setup) => {
      const save = vi.fn();
      render(<StaplesSetupScreen setup={initial} busy={false} onSave={save} onSkip={vi.fn()} />);
      return save;
    };
    const rowOf = (name: string) =>
      screen.getByRole("checkbox", { name }).closest(".staple-row") as HTMLElement;

    it("shows the catalog rule on a newly selected Toothbrush and Underwear", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Toothbrush" }));
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      expect(within(rowOf("Toothbrush")).getByText("1 per trip")).toBeTruthy();
      expect(within(rowOf("Underwear")).getByText("1 per day")).toBeTruthy();
    });

    it("shows no rule badge and no Edit on unselected suggestions", async () => {
      const user = userEvent.setup();
      renderSetup();
      expect(document.querySelectorAll(".staples-setup-rule")).toHaveLength(0);
      expect(screen.queryAllByRole("button", { name: /^Edit/ })).toHaveLength(0);
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      expect(document.querySelectorAll(".staples-setup-rule")).toHaveLength(1);
      expect(within(rowOf("Socks")).queryByText(/per day/)).toBeNull();
    });

    it("labels the Edit buttons with the item and its rule", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await user.click(screen.getByRole("checkbox", { name: "Toothbrush" }));
      expect(screen.getByRole("button", { name: "Edit Underwear, 1 per day" }).textContent).toBe(
        "Edit",
      );
      expect(screen.getByRole("button", { name: "Edit Toothbrush, 1 per trip" })).toBeTruthy();
    });

    it("describes the checkbox with its rule only while selected", async () => {
      const user = userEvent.setup();
      renderSetup();
      const box = screen.getByRole("checkbox", { name: "Underwear" });
      expect(box.getAttribute("aria-describedby")).toBeNull();
      await user.click(box);
      expect(box.getAttribute("aria-describedby")).toBe("setup-rule-underwear");
      expect(document.getElementById("setup-rule-underwear")?.textContent).toBe("1 per day");
      await user.click(box);
      expect(box.getAttribute("aria-describedby")).toBeNull();
      expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(box);
    });

    it("updates the summary, the Edit name and the status line after an editor save", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await user.click(screen.getByRole("button", { name: "Edit Underwear, 1 per day" }));
      let dialog = screen.getByRole("dialog", { name: "Edit staple" });
      await user.clear(within(dialog).getByLabelText("Quantity"));
      await user.type(within(dialog).getByLabelText("Quantity"), "2");
      await user.click(within(dialog).getByRole("radio", { name: /^Fixed per trip/ }));
      await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
      expect(within(rowOf("Underwear")).getByText("2 per trip")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Edit Underwear, 2 per trip" })).toBeTruthy();
      expect(screen.getByRole("status", { name: "Staples setup updates" }).textContent).toBe(
        "Underwear: 2 per trip.",
      );

      await user.click(screen.getByRole("button", { name: "Edit Underwear, 2 per trip" }));
      dialog = screen.getByRole("dialog", { name: "Edit staple" });
      await user.click(within(dialog).getByRole("radio", { name: /^Smart/ }));
      await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
      expect(within(rowOf("Underwear")).getByText("2 smart")).toBeTruthy();
    });

    it("cancelling the editor changes nothing", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await user.click(screen.getByRole("button", { name: "Edit Underwear, 1 per day" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Edit staple" })).getByRole("button", {
          name: "Close dialog",
        }),
      );
      expect(within(rowOf("Underwear")).getByText("1 per day")).toBeTruthy();
      expect(screen.getByRole("status", { name: "Staples setup updates" }).textContent).toBe("");
    });

    it("saves the catalog rule for selected suggestions", async () => {
      const user = userEvent.setup();
      const save = renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Toothbrush" }));
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await user.click(screen.getByRole("button", { name: "Save 2 Staples" }));
      expect(save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "toothbrush",
          qty: 1,
          cadence: "per trip",
          packLast: true,
          groupId: "toiletry-bag",
        }),
        expect.objectContaining({ id: "underwear", qty: 1, cadence: "per day" }),
      ]);
    });

    async function setUnderwearQty(user: ReturnType<typeof userEvent.setup>, qty: string) {
      await user.click(screen.getByRole("button", { name: /^Edit Underwear/ }));
      const dialog = screen.getByRole("dialog", { name: "Edit staple" });
      await user.clear(within(dialog).getByLabelText("Quantity"));
      await user.type(within(dialog).getByLabelText("Quantity"), qty);
      await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
    }

    it("keeps a customized quantity when other items are toggled", async () => {
      const user = userEvent.setup();
      const save = renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await setUnderwearQty(user, "3");
      await user.click(screen.getByRole("checkbox", { name: "Socks" }));
      await user.click(screen.getByRole("checkbox", { name: "Socks" }));
      await user.click(screen.getByRole("checkbox", { name: "Toothbrush" }));
      expect(within(rowOf("Underwear")).getByText("3 per day")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Save 2 Staples" }));
      expect(save).toHaveBeenCalledWith([
        expect.objectContaining({ id: "underwear", qty: 3, cadence: "per day" }),
        expect.objectContaining({ id: "toothbrush" }),
      ]);
    });

    it("keeps a customized quantity across a re-render with the same props", async () => {
      const user = userEvent.setup();
      const props = { busy: false, onSave: vi.fn(), onSkip: vi.fn() };
      const { rerender } = render(<StaplesSetupScreen setup={setup} {...props} />);
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await setUnderwearQty(user, "4");
      rerender(<StaplesSetupScreen setup={setup} {...props} saveError />);
      expect(within(rowOf("Underwear")).getByText("4 per day")).toBeTruthy();
    });

    it("starts from the saved list: a customized Underwear shows and saves its own quantity", async () => {
      const user = userEvent.setup();
      const saved: StaplesSetup = {
        state: "skipped",
        reminderDismissed: false,
        staples: [{ ...suggestion("underwear"), qty: 3 }],
      };
      const save = renderSetup(saved);
      expect(within(rowOf("Underwear")).getByText("3 per day")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Edit Underwear, 3 per day" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
      expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "underwear", qty: 3 })]);
    });

    it("returns to the catalog rule when the same item is unchecked and checked again", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await setUnderwearQty(user, "3");
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
      expect(within(rowOf("Underwear")).getByText("1 per day")).toBeTruthy();
    });

    it("shows the rule and a named Edit on custom item rows", async () => {
      const user = userEvent.setup();
      renderSetup();
      await user.click(screen.getByRole("button", { name: /Custom item/ }));
      const add = screen.getByRole("dialog", { name: "Add a staple" });
      await user.type(within(add).getByLabelText("Item name"), "Notebook");
      await user.click(within(add).getByRole("button", { name: "Add staple" }));
      const custom = screen.getByRole("heading", { name: "Your custom items" }).parentElement!
        .parentElement!;
      const badge = custom.querySelector(".staples-setup-rule")!;
      expect(badge.textContent).toMatch(/^\d+ per (trip|day)$/);
      expect(within(custom).getByText("Notebook")).toBeTruthy();
      expect(within(custom).getByText(/Other essentials|Clothing|Bathroom|Tech/)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: `Edit Notebook, ${badge.textContent}` }),
      ).toBeTruthy();
      expect(screen.getByRole("status", { name: "Staples setup updates" }).textContent).toBe(
        `Notebook: ${badge.textContent}.`,
      );
    });
  });
});
