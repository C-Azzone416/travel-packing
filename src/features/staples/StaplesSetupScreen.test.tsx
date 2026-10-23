// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StaplesSetup } from "@/domain/staples-setup";
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
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    expect(save).toHaveBeenCalledWith([]);
  });

  it("selects only chosen suggestions and edits cadence, placement, and Pack last independently", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<StaplesSetupScreen setup={setup} busy={false} onSave={save} onSkip={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
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
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove staple" }),
    );
    await waitFor(() => expect(screen.queryByText("Your custom items")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    expect(save).toHaveBeenCalledWith([]);
  });
});
