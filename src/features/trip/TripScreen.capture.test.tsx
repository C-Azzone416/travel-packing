// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import * as SourceContext from "@/features/trips/TripsSourceProvider";
import {
  createMemoryTripsSource,
  TripsSourceError,
  type TripsSource,
} from "@/features/trips/trips-source";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import type { Staple, TripItem } from "@/domain/trip";
import { TripScreen } from "./TripScreen";
import { ItemEditor } from "./ItemEditor";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push: vi.fn() }),
}));
const useOriginalSource = SourceContext.useTripsSource;
afterEach(() => vi.restoreAllMocks());
function Shell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SaveStatusProvider>{children}</SaveStatusProvider>
    </ToastProvider>
  );
}
function fixture() {
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    today: () => "2026-10-16",
  });
}
const trip = (base: ReturnType<typeof fixture>) => base.snapshot().trips[0];
const dialog = () => screen.getByRole("dialog", { name: "Edit item" });
const remember = () =>
  fireEvent.click(within(dialog()).getByRole("radio", { name: /Remember for future trips/ }));
const save = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Save item" }));
async function open(base: TripsSource, path: "normal" | "url" = "url", id = "underwear") {
  const ui = (source: TripsSource) => (
    <TripsSourceProvider source={source}>
      <TripScreen tripId="san-diego" openItemId={path === "url" ? id : undefined} />
    </TripsSourceProvider>
  );
  const view = render(ui(base), { wrapper: Shell });
  await screen.findByRole("heading", { name: "Pack mode" });
  if (path === "normal") {
    fireEvent.click(screen.getByRole("button", { name: "Edit list" }));
    const row = document.querySelector(`[data-item-id="${id}"]`)!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^Edit / }));
  }
  if (id !== "missing") await screen.findByRole("dialog", { name: "Edit item" });
  return {
    ...view,
    refresh: (source: TripsSource) => {
      // Controlled context-replacement seam: the shipped provider latches its initial source.
      // Exercise TripScreen's source/read effect without changing that provider or claiming a shipped refresh trigger.
      vi.spyOn(SourceContext, "useTripsSource").mockImplementation(function useRefreshedSource() {
        useOriginalSource();
        return source;
      });
      view.rerender(ui(source));
    },
  };
}

for (const path of ["normal", "url"] as const) {
  it.each(["edit", "delete", "recreate"] as const)(
    `${path}: opening token survives external %s and controlled context reread; no stale write`,
    async (external) => {
      const base = fixture();
      const original = base.staplesSnapshot().find((row) => row.id === "underwear")!;
      const edit = vi.fn(base.editItem);
      const source = { ...base, editItem: edit };
      const view = await open(source, path);
      const originalDialog = dialog();
      const quantity = within(originalDialog).getByLabelText("Quantity") as HTMLInputElement;
      fireEvent.change(quantity, { target: { value: "9" } });
      remember();
      expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toContain(
        "2 per day",
      );
      if (external === "edit")
        await base.upsertStaple({ ...original, qty: 7, cadence: "per trip" }, original.revision!);
      else {
        await base.removeStaple(original.id, original.revision!);
        if (external === "recreate")
          await base.upsertStaple({ ...original, qty: 7, cadence: "per trip" }, null);
      }
      const before = structuredClone({ state: base.snapshot(), staples: base.staplesSnapshot() });
      const read = vi.fn(base.listStaples);
      await act(async () => view.refresh({ ...source, listStaples: read }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      expect(dialog()).toBe(originalDialog);
      expect(quantity.value).toBe("9");
      expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toContain(
        "2 per day",
      );
      save();
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole("alert", { name: "Save error" }).textContent).toContain("Couldn"),
      );
      expect(edit).toHaveBeenCalledExactlyOnceWith(
        "san-diego",
        "underwear",
        { name: "Underwear", qty: 9, timing: "main", scope: "remember" },
        original.revision,
      );
      expect(base.snapshot()).toEqual(before.state);
      expect(base.staplesSnapshot()).toEqual(before.staples);
    },
  );
}

describe("opening capture and confirmed metadata", () => {
  it("missing ?edit item is consumed without cloning undefined or opening a dialog", async () => {
    await open(fixture(), "url", "missing");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["remember", "this-trip"] as const)(
    "existing row missing read revision: %s preserves runtime compatibility",
    async (scope) => {
      const base = fixture();
      const before = structuredClone(base.snapshot());
      const edit = vi.fn(base.editItem);
      await open({
        ...base,
        editItem: edit,
        listStaples: async () =>
          base.staplesSnapshot().map((row) => {
            const detached = { ...row };
            delete detached.revision;
            return detached;
          }),
      });
      if (scope === "remember") remember();
      save();
      if (scope === "remember") {
        // Missing metadata now refuses the local immutable operation before transport.
        expect(edit).not.toHaveBeenCalled();
        await waitFor(() =>
          expect(screen.getByRole("alert", { name: "Save error" }).textContent).toContain("Couldn"),
        );
        expect(base.snapshot()).toEqual(before);
      } else {
        await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
        expect(edit.mock.calls[0][3]).toBeUndefined();
        expect(edit.mock.calls[0]).toHaveLength(4);
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }
    },
  );
  it("reviewed default absence is explicit null, creating a remembered rule", async () => {
    const base = fixture();
    const original = base.staplesSnapshot().find((row) => row.id === "underwear")!;
    await base.removeStaple(original.id, original.revision!);
    const edit = vi.fn(base.editItem);
    await open({ ...base, editItem: edit });
    remember();
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(edit.mock.calls[0][3]).toBeNull();
    expect(base.staplesSnapshot().find((row) => row.id === original.id)?.revision).toBeTruthy();
  });
  it("opening snapshot detaches the returned metadata object", async () => {
    const base = fixture();
    const displayed = await base.listStaples();
    const opening = structuredClone(displayed.find((row) => row.id === "underwear")!.revision);
    const edit = vi.fn(base.editItem);
    await open({ ...base, editItem: edit, listStaples: async () => displayed });
    displayed.find((row) => row.id === "underwear")!.revision!.version += 100;
    remember();
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(edit.mock.calls[0][3]).toEqual(opening);
  });
  it("failed background read preserves same live draft; later successful read cannot rebase it", async () => {
    const base = fixture();
    const view = await open(base);
    const originalDialog = dialog();
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Held name" } });
    const read = vi.fn().mockRejectedValue(new TripsSourceError("INTERNAL"));
    await act(async () => view.refresh({ ...base, listStaples: read }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(dialog()).toBe(originalDialog);
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("Held name");
    await act(async () => view.refresh({ ...base }));
    expect(dialog()).toBe(originalDialog);
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("Held name");
  });
  it.each(["edit", "remove"] as const)(
    "%s success uses returned persisted metadata/absence for next opening, no reread fallback",
    async (kind) => {
      const base = fixture();
      const rows = base.staplesSnapshot();
      const original = rows.find((row) => row.id === "last-toothbrush")!;
      const persisted = {
        ...original,
        cadence: "per day" as const,
        qty: 3,
        revision: { ...original.revision!, version: 41 },
      };
      const resultRows =
        kind === "edit"
          ? rows.map((row) => (row.id === original.id ? persisted : row))
          : rows.filter((row) => row.id !== original.id);
      const edit = vi.fn(async (...args: Parameters<TripsSource["editItem"]>) => {
        const change = await base.editItem(...args);
        return { ...change, staples: resultRows };
      });
      const remove = vi.fn(async (...args: Parameters<TripsSource["removeItem"]>) => ({
        ...(await base.removeItem(...args)),
        staples: resultRows,
      }));
      const list = vi.fn(base.listStaples);
      await open(
        { ...base, editItem: edit, removeItem: remove, listStaples: list },
        "url",
        original.id,
      );
      remember();
      if (kind === "edit") save();
      else {
        fireEvent.click(screen.getByRole("button", { name: "Remove item" }));
        fireEvent.click(screen.getByRole("button", { name: "Remove item" }));
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(list).toHaveBeenCalledTimes(1);
      if (kind === "edit") {
        fireEvent.click(screen.getByRole("button", { name: "Edit list" }));
        const row = document.querySelector(`[data-item-id="${original.id}"]`)!;
        fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^Edit / }));
        remember();
        save();
        await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
        expect(edit.mock.calls[1][3]).toEqual(persisted.revision);
        // The transport deliberately stamped41; memoryCAS correctly refuses it rather than fetching a replacement.
        await waitFor(() =>
          expect(screen.getByRole("alert", { name: "Save error" }).textContent).toContain("Couldn"),
        );
        expect(list).toHaveBeenCalledTimes(1);
      }
    },
  );
});

it("ItemEditor retains full opening item/destination/cadence/day view across incoming props", async () => {
  const base = fixture();
  const item = trip(base).items.find((row) => row.id === "underwear")!;
  const defaults = base.staplesSnapshot();
  const opening = defaults.find((row) => row.id === item.id)!.revision;
  const onSave = vi.fn(async () =>
    base.editItem(
      "san-diego",
      item.id,
      { name: item.name, qty: 9, timing: "main", scope: "remember" },
      opening,
    ),
  );
  const ui = (entry: TripItem, rows: Staple[], days: number, destination: string) => (
    <ItemEditor
      item={entry}
      staples={rows}
      tripDays={days}
      destination={destination}
      saving={false}
      onClose={vi.fn()}
      onSave={onSave}
      onRemove={vi.fn()}
      onReview={vi.fn()}
      onWrite={(write) => void write()}
    />
  );
  const view = render(ui(item, defaults, 5, "Opening city"), { wrapper: Shell });
  const name = screen.getByLabelText("Item name");
  view.rerender(
    ui(
      {
        ...item,
        name: "New name",
        qty: 40,
        section: "return",
        optional: true,
        groupId: "toiletry-bag",
      },
      defaults.map((row) => ({
        ...row,
        cadence: "per trip",
        laundryHalves: true,
        revision: { ...row.revision!, version: 99 },
      })),
      1,
      "New city",
    ),
  );
  expect(screen.getByLabelText("Item name")).toBe(name);
  expect((name as HTMLInputElement).value).toBe(item.name);
  expect(screen.getByRole("switch", { name: "Pack last" })).toBeTruthy();
  expect(screen.queryByText(/Return outfit item/)).toBeNull();
  expect(screen.queryByText(/Optional suggestion/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove item" })).toBeNull();
  expect(screen.getByText("Update Opening city only.")).toBeTruthy();
  remember();
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "9" } });
  expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toContain("2 per day");
  save();
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    { name: item.name, qty: 9, timing: "main", scope: "remember" },
    opening,
  );
});

it.each([
  ["per day", false, 5, "Saved as 2 per day for future trips."],
  ["per day", true, 5, ""],
  ["per night", false, 5, ""],
  ["per trip", false, 5, ""],
  ["per day", false, 0, "This trip has no calendar days, so the saved quantity stays the same."],
] as const)(
  "opening preview preserves %s/laundry=%s/days=%s conversion rules",
  (cadence, laundryHalves, days, expected) => {
    const base = fixture();
    const item = trip(base).items.find((row) => row.id === "underwear")!;
    const rows = base
      .staplesSnapshot()
      .map((row) => (row.id === item.id ? { ...row, cadence, laundryHalves } : row));
    render(
      <ItemEditor
        item={item}
        staples={rows}
        tripDays={days}
        destination="Opening"
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onReview={vi.fn()}
        onWrite={vi.fn()}
      />,
      { wrapper: Shell },
    );
    remember();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "9" } });
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe(expected);
  },
);

it("same-item close/reopen in one React batch creates a fresh editor generation", async () => {
  const base = fixture();
  const view = await open(base, "normal");
  const first = dialog();
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Unsaved draft" } });
  const fresh = structuredClone(trip(base));
  fresh.days = 12;
  fresh.destination = "Fresh destination";
  fresh.items = fresh.items.map((row) =>
    row.id === "underwear" ? { ...row, name: "Fresh Underwear", qty: 12 } : row,
  );
  const getTrip = vi.fn(async () => fresh);
  await act(async () => view.refresh({ ...base, getTrip }));
  await waitFor(() => expect(getTrip).toHaveBeenCalledTimes(1));
  expect(dialog()).toBe(first);
  const opener = within(
    document.querySelector('[data-item-id="underwear"]') as HTMLElement,
  ).getByRole("button", { name: /^Edit Fresh Underwear/ });
  const close = within(first).getByRole("button", { name: "Close dialog" });
  act(() => {
    close.click();
    opener.click();
  });
  expect(dialog()).not.toBe(first);
  expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("Fresh Underwear");
  expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("12");
  expect(screen.getByText("Update Fresh destination only.")).toBeTruthy();
});
