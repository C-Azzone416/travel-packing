// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Staple } from "@/domain/trip";
import type { StaplesSetupResult } from "../trips/trip-actions";
import { StaplesSetupGate, type StaplesSetupActions } from "./StaplesSetupGate";

vi.mock("next/navigation", () => ({ usePathname: () => "/staples" }));

const row: Staple = {
  id: "underwear",
  name: "Underwear",
  category: "Clothing",
  qty: 4,
  cadence: "per day",
  packLast: false,
  revision: { rowId: "00000000-0000-4000-8000-000000000001", version: 1 },
};
const fresh: Staple = { ...row, qty: 9, revision: { ...row.revision!, version: 2 } };
const scarf: Staple = {
  ...row,
  id: "scarf",
  name: "Scarf",
  revision: {
    rowId: "00000000-0000-4000-8000-000000000002",
    version: 1,
  },
};
const baseline = [{ semanticId: row.id, revision: row.revision }];
const answer = (
  staples: Staple[] = [row],
  state: "incomplete" | "skipped" | "completed" = "incomplete",
): StaplesSetupResult => ({ ok: true, state, reminderDismissed: false, staples });
const deferred = () => {
  let resolve!: (result: StaplesSetupResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<StaplesSetupResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
type Outcome = "fresh" | "reject" | "completed";
const outcomes: Outcome[] = ["fresh", "reject", "completed"];
const settle = async (pending: ReturnType<typeof deferred>, outcome: Outcome) => {
  await act(async () => {
    if (outcome === "reject") pending.reject(new Error("background offline"));
    else
      pending.resolve(answer([fresh, scarf], outcome === "completed" ? "completed" : "incomplete"));
  });
};
function mount(get = vi.fn<StaplesSetupActions["get"]>(async () => answer())) {
  const api: StaplesSetupActions = {
    get,
    save: vi.fn<StaplesSetupActions["save"]>(async () => ({ ok: false, code: "STALE" })),
    skip: vi.fn(async () => answer([], "skipped")),
    dismiss: vi.fn(async () => ({ ...answer([], "skipped"), reminderDismissed: true })),
  };
  const content = (actions: StaplesSetupActions) => (
    <StaplesSetupGate actions={actions}>
      <div>Trips</div>
    </StaplesSetupGate>
  );
  const view = render(content(api));
  return { api, refresh: (actions: StaplesSetupActions) => view.rerender(content(actions)) };
}

describe("setup editor read generation", () => {
  for (const entry of ["incomplete", "skipped", "retry"] as const) {
    it.each(outcomes)(
      `${entry}: pre-Save background %s keeps checkbox and custom-editor DOM, values and original baseline`,
      async (outcome) => {
        const user = userEvent.setup();
        const get = vi.fn<StaplesSetupActions["get"]>(async () =>
          answer([row], entry === "skipped" ? "skipped" : "incomplete"),
        );
        if (entry === "retry") get.mockRejectedValueOnce(new Error("initial offline"));
        const { api, refresh } = mount(get);
        if (entry === "retry")
          await user.click(await screen.findByRole("button", { name: "Try again" }));
        if (entry === "skipped")
          await user.click(await screen.findByRole("button", { name: "Review Staples" }));
        const box = await screen.findByRole("checkbox", { name: "Underwear" });
        await user.click(box);
        await user.click(screen.getByRole("checkbox", { name: "Socks" }));
        await user.click(screen.getByRole("button", { name: /Custom item/ }));
        const dialog = screen.getByRole("dialog");
        const name = screen.getByRole("textbox", { name: "Item name" }) as HTMLInputElement;
        const qty = screen.getByRole("spinbutton", { name: "Quantity" }) as HTMLInputElement;
        await user.type(name, "Draft hat");
        await user.clear(qty);
        await user.type(qty, "7");
        await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Clothing");
        await user.click(screen.getByRole("switch", { name: /Pack last/ }));
        const pending = deferred();
        const currentSave = vi.fn<StaplesSetupActions["save"]>(async () => ({
          ok: false,
          code: "STALE",
        }));
        const next = { ...api, get: vi.fn(() => pending.promise), save: currentSave };
        refresh(next);
        await waitFor(() => expect(next.get).toHaveBeenCalledTimes(1));
        await settle(pending, outcome);
        expect(screen.queryByText("Couldn’t load your Staples setup.")).toBeNull();
        expect(screen.queryByText("Trips")).toBeNull();
        expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(box);
        expect((box as HTMLInputElement).checked).toBe(false);
        expect((screen.getByRole("checkbox", { name: "Socks" }) as HTMLInputElement).checked).toBe(
          true,
        );
        expect(screen.getByRole("dialog")).toBe(dialog);
        expect(screen.getByRole("textbox", { name: "Item name" })).toBe(name);
        expect(screen.getByRole("spinbutton", { name: "Quantity" })).toBe(qty);
        expect(name.value).toBe("Draft hat");
        expect(qty.value).toBe("7");
        expect(
          (screen.getByRole("combobox", { name: "Category" }) as HTMLSelectElement).value,
        ).toBe("Clothing");
        expect(
          (screen.getByRole("switch", { name: /Pack last/ }) as HTMLInputElement).checked,
        ).toBe(true);
        await user.click(screen.getByRole("button", { name: "Add staple" }));
        await user.click(screen.getByRole("button", { name: "Save 2 Staples" }));
        expect(api.save).not.toHaveBeenCalled();
        expect(currentSave).toHaveBeenCalledWith(
          [
            expect.objectContaining({ id: "socks", qty: 1 }),
            expect.objectContaining({
              name: "Draft hat",
              qty: 7,
              category: "Clothing",
              packLast: true,
            }),
          ],
          baseline,
        );
      },
    );
  }

  it.each(outcomes)(
    "an open existing-item editor survives background %s without rebasing",
    async (outcome) => {
      const user = userEvent.setup();
      const { api, refresh } = mount();
      await user.click(await screen.findByRole("button", { name: "Edit Underwear, 4 per day" }));
      const input = screen.getByRole("spinbutton", { name: "Quantity" }) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, "6");
      const pending = deferred();
      const next = { ...api, get: vi.fn(() => pending.promise) };
      refresh(next);
      await waitFor(() => expect(next.get).toHaveBeenCalledTimes(1));
      await settle(pending, outcome);
      expect(screen.getByRole("spinbutton", { name: "Quantity" })).toBe(input);
      expect(input.value).toBe("6");
      await user.click(screen.getByRole("button", { name: "Save staple" }));
      await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
      expect(api.save).toHaveBeenCalledWith(
        [expect.objectContaining({ id: row.id, qty: 6 })],
        baseline,
      );
    },
  );

  for (const order of [
    "before failed review",
    "during successful review",
    "after successful review",
  ] as const) {
    it.each(outcomes)(
      `background %s ${order} cannot replace either retained or reviewed generation`,
      async (outcome) => {
        const user = userEvent.setup();
        const { api, refresh } = mount();
        const box = await screen.findByRole("checkbox", { name: "Underwear" });
        await user.click(box);
        await user.click(screen.getByRole("checkbox", { name: "Socks" }));
        const background = deferred();
        const failedReview = deferred();
        const goodReview = deferred();
        const get = vi
          .fn<StaplesSetupActions["get"]>()
          .mockReturnValueOnce(background.promise)
          .mockReturnValueOnce(failedReview.promise)
          .mockReturnValueOnce(goodReview.promise);
        refresh({ ...api, get });
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
        await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
        await user.click(await screen.findByRole("button", { name: "Reload and discard changes" }));
        if (order === "before failed review") await settle(background, outcome);
        await act(async () => failedReview.reject(new Error("explicit review offline")));
        await screen.findByRole("button", { name: "Try again" });
        expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(box);
        expect((box as HTMLInputElement).checked).toBe(false);
        expect((box as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole("checkbox", { name: "Socks" }) as HTMLInputElement).checked).toBe(
          true,
        );
        expect(api.save).toHaveBeenCalledWith([expect.objectContaining({ id: "socks" })], baseline);
        await user.click(screen.getByRole("button", { name: "Try again" }));
        if (order === "during successful review") await settle(background, outcome);
        await act(async () => goodReview.resolve(answer([fresh])));
        const reviewed = screen.getByRole("checkbox", { name: "Underwear" });
        expect(reviewed).not.toBe(box);
        expect((reviewed as HTMLInputElement).checked).toBe(true);
        if (order === "after successful review") await settle(background, outcome);
        const later = deferred();
        const laterGet = vi.fn(() => later.promise);
        refresh({ ...api, get: laterGet });
        await waitFor(() => expect(laterGet).toHaveBeenCalledTimes(1));
        await settle(later, outcome);
        expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(reviewed);
        expect(screen.getByRole("button", { name: "Edit Underwear, 9 per day" })).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
        expect(api.save).toHaveBeenLastCalledWith(
          [expect.objectContaining({ qty: 9 })],
          [{ semanticId: row.id, revision: fresh.revision }],
        );
        expect(get).toHaveBeenCalledTimes(3);
      },
    );
  }
});
