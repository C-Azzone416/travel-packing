// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StaplesSetupResult } from "../trips/trip-actions";
import type { Staple } from "@/domain/trip";
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
const answer = (staples: Staple[] = [row]): StaplesSetupResult => ({
  ok: true,
  state: "incomplete",
  reminderDismissed: false,
  staples,
});
function mount(api: Partial<StaplesSetupActions> = {}) {
  const actions: StaplesSetupActions = {
    get: vi.fn(async () => answer()),
    save: vi.fn(async (): Promise<StaplesSetupResult> => ({ ok: false, code: "INTERNAL" })),
    skip: vi.fn(async () => answer([])),
    dismiss: vi.fn(async () => answer([])),
    ...api,
  };
  render(
    <StaplesSetupGate actions={actions}>
      <div>Trips</div>
    </StaplesSetupGate>,
  );
  return actions;
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const baseline = [{ semanticId: row.id, revision: row.revision }];
describe("setup retained save recovery", () => {
  it("freezes the complete initial baseline including unchecked rows and keeps original retry values, with single flight", async () => {
    const user = userEvent.setup();
    const first = deferred<StaplesSetupResult>();
    const retry = deferred<StaplesSetupResult>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const api = mount({ save });
    const box = await screen.findByRole("checkbox", { name: "Underwear" });
    await user.click(box);
    await user.click(screen.getByRole("checkbox", { name: "Socks" }));
    await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "socks", qty: 1 })], baseline);
    const [values, captured] = save.mock.calls[0];
    expect(Object.isFrozen(values)).toBe(true);
    expect(Object.isFrozen(values[0])).toBe(true);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured[0].revision)).toBe(true);
    for (const control of [
      ...screen.getAllByRole("checkbox"),
      screen.getByRole("button", { name: /Custom item/ }),
      ...screen.getAllByRole("button", { name: /^Edit / }),
    ])
      expect((control as HTMLInputElement).disabled).toBe(true);
    await act(async () => first.resolve({ ok: false, code: "INTERNAL" }));
    expect((box as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Socks" }));
    const retryButton = screen.getByRole("button", { name: "Try save again" });
    await user.dblClick(retryButton);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(values);
    expect(save.mock.calls[1][1]).toBe(captured);
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => retry.resolve({ ok: false, code: "STALE" }));
    expect(screen.queryByRole("button", { name: "Try save again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload and discard changes" })).toBeTruthy();
  });

  it("failed explicit reload retains intent and locks; successful review remounts the local editor and uses a fresh baseline only on new Save", async () => {
    const user = userEvent.setup();
    const fresh = { ...row, qty: 9, revision: { ...row.revision!, version: 2 } };
    const get = vi
      .fn()
      .mockResolvedValueOnce(answer())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer([fresh]));
    const save = vi.fn().mockResolvedValue({ ok: false, code: "STALE" });
    mount({ get, save });
    const originalBox = await screen.findByRole("checkbox", { name: "Underwear" });
    await user.click(originalBox);
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    await user.click(await screen.findByRole("button", { name: "Reload and discard changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
    const box = screen.getByRole("checkbox", { name: "Underwear" }) as HTMLInputElement;
    expect(box).toBe(originalBox);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try save again" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    const edit = await screen.findByRole("button", { name: "Edit Underwear, 9 per day" });
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Underwear" })).not.toBe(originalBox);
    expect((screen.getByRole("checkbox", { name: "Underwear" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
    expect(save).toHaveBeenLastCalledWith(
      [expect.objectContaining({ qty: 9 })],
      [{ semanticId: row.id, revision: fresh.revision }],
    );
  });

  it("captures membership at the read and replays a thrown network failure without fetching a new baseline", async () => {
    const user = userEvent.setup();
    const loadedRow = { ...row, revision: { ...row.revision! } };
    const get = vi.fn(async () => answer([loadedRow]));
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network reply lost"))
      .mockResolvedValueOnce({
        ok: true,
        state: "completed",
        reminderDismissed: false,
        staples: [],
      });
    mount({ get, save });
    await screen.findByRole("button", { name: "Save 1 Staples" });
    // Mutating the transport's old DTO cannot rebase the detached read baseline.
    loadedRow.revision.version = 7;
    await user.click(screen.getByRole("checkbox", { name: "Underwear" }));
    await user.click(screen.getByRole("button", { name: "Save empty Staples" }));
    await user.click(await screen.findByRole("button", { name: "Try save again" }));
    expect(await screen.findByText("Trips")).toBeTruthy();
    expect(save).toHaveBeenNthCalledWith(1, [], baseline);
    expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
    expect(save.mock.calls[1][1]).toBe(save.mock.calls[0][1]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "fresh"] as const)(
    "a background %s read leaves the failed editor mounted and its original intent locked",
    async (outcome) => {
      const user = userEvent.setup();
      const background = deferred<StaplesSetupResult>();
      const get = vi.fn(async () => answer());
      const save = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
        .mockResolvedValueOnce({ ok: false, code: "STALE" });
      const api: StaplesSetupActions = {
        get,
        save,
        skip: vi.fn(async () => answer()),
        dismiss: vi.fn(async () => answer()),
      };
      const view = render(
        <StaplesSetupGate actions={api}>
          <div>Trips</div>
        </StaplesSetupGate>,
      );
      const original = await screen.findByRole("checkbox", { name: "Underwear" });
      await user.click(original);
      await user.click(screen.getByRole("checkbox", { name: "Socks" }));
      await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
      await screen.findByRole("button", { name: "Try save again" });
      const retryValues = save.mock.calls[0];
      const nextGet = vi.fn(() =>
        outcome === "reject"
          ? background.promise.then(() => {
              throw new Error("background read failed");
            })
          : background.promise,
      );
      view.rerender(
        <StaplesSetupGate actions={{ ...api, get: nextGet }}>
          <div>Trips</div>
        </StaplesSetupGate>,
      );
      await waitFor(() => expect(nextGet).toHaveBeenCalledTimes(1));
      await act(async () =>
        background.resolve(
          answer([{ ...row, qty: 9, revision: { ...row.revision!, version: 2 } }]),
        ),
      );
      expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(original);
      expect((original as HTMLInputElement).checked).toBe(false);
      expect((original as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("checkbox", { name: "Socks" }) as HTMLInputElement).checked).toBe(
        true,
      );
      expect(screen.queryByText("Couldn’t load your Staples setup.")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Try save again" }));
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toBe(retryValues[0]);
      expect(save.mock.calls[1][1]).toBe(retryValues[1]);
      expect(save.mock.calls[1][1]).toEqual(baseline);
    },
  );

  it("a reload with missing read revision fails closed without discarding the failed intent", async () => {
    const user = userEvent.setup();
    const get = vi
      .fn()
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(answer([{ ...row, revision: undefined, qty: 9 }]));
    mount({
      get,
      save: vi.fn(async (): Promise<StaplesSetupResult> => ({ ok: false, code: "INVALID_INPUT" })),
    });
    await user.click(await screen.findByRole("button", { name: "Save 1 Staples" }));
    await user.click(await screen.findByRole("button", { name: "Reload and discard changes" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Edit Underwear, 4 per day" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Try save again" })).toBeNull();
  });

  it("missing initial read revisions require another read rather than permitting Save", async () => {
    mount({ get: vi.fn(async () => answer([{ ...row, revision: undefined }])) });
    expect(await screen.findByText("Couldn’t load your Staples setup.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save .*Staples/ })).toBeNull();
  });
});
