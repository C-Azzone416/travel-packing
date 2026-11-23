// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { SaveStatusProvider, useSaveStatus } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import * as SourceContext from "@/features/trips/TripsSourceProvider";
import type { StapleRevision } from "@/domain/calc/staples";
type ReviewedTrip = Awaited<ReturnType<TripsSource["getTrip"]>>;
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import {
  createMemoryTripsSource,
  type TripChange,
  type TripsSource,
} from "@/features/trips/trips-source";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { TripScreen } from "./TripScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push: vi.fn() }),
}));
let status: ReturnType<typeof useSaveStatus>;
function Observe() {
  const api = useSaveStatus();
  useEffect(() => {
    status = api;
  }, [api]);
  return null;
}
function Shell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SaveStatusProvider>
        <Observe />
        {children}
      </SaveStatusProvider>
    </ToastProvider>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    today: () => "2026-10-16",
  });
}
const snapshot = (base: ReturnType<typeof fixture>) =>
  structuredClone({
    state: base.snapshot(),
    staples: base.staplesSnapshot(),
  });
const editor = () => screen.getByRole("dialog", { name: "Edit item" });
const click = (name: string | RegExp, dialog = editor()) =>
  fireEvent.click(within(dialog).getByRole("button", { name }));
const remember = () =>
  fireEvent.click(within(editor()).getByRole("radio", { name: /Remember for future trips/ }));
const name = () => within(editor()).getByLabelText("Item name") as HTMLInputElement;
const originalSource = SourceContext.useTripsSource;
afterEach(() => vi.restoreAllMocks());
async function open(source: TripsSource, id = "underwear", path: "url" | "normal" = "url") {
  const view = render(
    <TripsSourceProvider source={source}>
      <TripScreen tripId="san-diego" openItemId={path === "url" ? id : undefined} />
    </TripsSourceProvider>,
    { wrapper: Shell },
  );
  await screen.findByRole("heading", { name: "Pack mode" });
  if (path === "normal") {
    if (id.startsWith("last-"))
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "Cubes" })).getByRole("button", {
          name: /Toiletries/,
        }),
      );
    await reopen(id);
  }
  await screen.findByRole("dialog", { name: "Edit item" });
  return view;
}
async function reopen(id = "underwear") {
  if (screen.queryByRole("button", { name: "Edit list" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit list" }));
  const row = document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /^Edit / }));
  await screen.findByRole("dialog", { name: "Edit item" });
}
async function failed() {
  await screen.findByRole("button", { name: "Discard change and close" });
}
function locked() {
  const d = editor();
  for (const control of d.querySelectorAll("input, [role=switch]"))
    expect(control.matches(":disabled")).toBe(true);
  expect((within(d).getByRole("button", { name: "Save item" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (within(d).getByRole("button", { name: "Close dialog" }) as HTMLButtonElement).disabled,
  ).toBe(false);
}

function setup(returnItem = false) {
  const seed = sampleLifecycleState();
  if (returnItem) seed.trips[0].items.find((row) => row.id === "underwear")!.section = "return";
  const base = returnItem
    ? createMemoryTripsSource(seed, { now: () => 1, today: () => "2026-10-16" })
    : fixture();
  const getTrip = vi.fn(base.getTrip);
  const listStaples = vi.fn(base.listStaples);
  const editItem = vi.fn(base.editItem).mockRejectedValueOnce(new Error("offline"));
  const removeItem = vi.fn(base.removeItem).mockRejectedValueOnce(new Error("offline"));
  return {
    base,
    getTrip,
    listStaples,
    editItem,
    removeItem,
    source: { ...base, getTrip, listStaples, editItem, removeItem },
  };
}
async function fail(_f: ReturnType<typeof setup>, kind: "edit" | "remove") {
  remember();
  fireEvent.change(name(), { target: { value: "Original unsaved draft" } });
  fireEvent.change(within(editor()).getByLabelText("Quantity"), { target: { value: "19" } });
  if (kind === "edit") click("Save item");
  else {
    click("Remove item");
    click("Remove item", screen.getByRole("dialog"));
  }
  await failed();
  return screen.getByRole("dialog");
}
const review = (d = screen.getByRole("dialog")) => click("Reload and review", d);
const held = () => screen.findByText(/Couldn’t reload/);
const calls = (f: ReturnType<typeof setup>, kind: "edit" | "remove") =>
  kind === "edit" ? f.editItem.mock.calls : f.removeItem.mock.calls;

it("fail-first: explicit review is offered without automatic write/read or unlocking", async () => {
  const f = setup();
  await open(f.source);
  await fail(f, "edit");
  expect(within(editor()).queryByRole("button", { name: "Reload and review" })).not.toBeNull();
  expect(f.getTrip).toHaveBeenCalledTimes(1);
  expect(f.listStaples).toHaveBeenCalledTimes(1);
  expect(f.editItem).toHaveBeenCalledTimes(1);
  locked();
});

for (const path of ["url", "normal"] as const)
  for (const kind of ["edit", "remove"] as const) {
    it(`${path}/${kind}: failed fresh reads preserve exact dialog, fields, scope, lock and original tokens`, async () => {
      const f = setup();
      await open(f.source, kind === "remove" ? "last-toothbrush" : "underwear", path);
      const editDialog = editor();
      const input = name();
      const d = await fail(f, kind);
      const original = calls(f, kind)[0];
      const before = snapshot(f.base);
      for (const failing of ["trip", "defaults"] as const) {
        if (failing === "trip") f.getTrip.mockRejectedValueOnce(new Error("read failure"));
        else f.listStaples.mockRejectedValueOnce(new Error("read failure"));
        review(d);
        await held();
        expect(screen.getByRole("dialog")).toBe(d);
        expect(snapshot(f.base)).toEqual(before);
        expect(calls(f, kind)).toHaveLength(1);
        expect(calls(f, kind)[0][3]).toBe(original[3]);
        if (kind === "edit") {
          expect(editor()).toBe(editDialog);
          expect(name()).toBe(input);
          expect(input.value).toBe("Original unsaved draft");
          expect((within(d).getByLabelText("Quantity") as HTMLInputElement).value).toBe("19");
          expect(
            (
              within(d).getByRole("radio", {
                name: /Remember for future trips/,
              }) as HTMLInputElement
            ).checked,
          ).toBe(true);
          locked();
        } else {
          expect(d.textContent).toContain("future trips will not add it");
          expect(
            (within(d).getByRole("button", { name: "Keep item" }) as HTMLButtonElement).disabled,
          ).toBe(true);
        }
        act(() => status.retry());
        expect(calls(f, kind)).toHaveLength(1);
      }
    });
  }

it.each([
  undefined,
  null,
  {},
  { rowId: "bad", version: 1 },
  { rowId: "00000000-0000-4000-8000-000000000001", version: 0 },
  { rowId: "00000000-0000-4000-8000-000000000001", version: 1.5 },
  { rowId: "00000000-0000-4000-8000-000000000001", version: 2147483648 },
  { rowId: "00000000-0000-4000-8000-000000000001", version: "1" },
  { rowId: "00000000-0000-4000-8000-000000000001", version: 1, extra: true },
])("review rejects malformed required metadata %j without partial reset", async (revision) => {
  const f = setup();
  await open(f.source);
  const input = name();
  const d = await fail(f, "edit");
  const fresh = structuredClone(await f.base.getTrip("san-diego"));
  fresh.destination = "Fresh destination must stay hidden";
  fresh.items.find((row) => row.id === "underwear")!.name = "Fresh name must stay hidden";
  f.getTrip.mockResolvedValueOnce(fresh);
  f.listStaples.mockResolvedValueOnce(
    f.base
      .staplesSnapshot()
      .map((row) =>
        row.id === "underwear" ? { ...row, revision: revision as StapleRevision } : row,
      ),
  );
  review();
  await waitFor(() =>
    expect(
      (within(d).queryByRole("button", { name: "Reload and review" }) as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(false),
  );
  expect(name().value).toBe("Original unsaved draft");
  await held();
  expect(editor()).toBe(d);
  expect(name()).toBe(input);
  expect(input.value).toBe("Original unsaved draft");
  expect(d.textContent).not.toContain("Fresh destination must stay hidden");
  expect(
    (within(d).getByRole("radio", { name: /Remember for future trips/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  locked();
  act(() => status.retry());
  expect(f.editItem).toHaveBeenCalledTimes(1);
});

for (const path of ["url", "normal"] as const)
  for (const kind of ["edit", "remove"] as const) {
    it(`${path}/${kind}: review is singleflight and retires exact old closure BEFORE provider discard refusal or reads`, async () => {
      const f = setup();
      await open(f.source, kind === "remove" ? "last-toothbrush" : "underwear", path);
      const d = await fail(f, kind);
      const other = deferred<unknown>();
      let tracked!: Promise<unknown>;
      act(() => {
        tracked = status.track(() => other.promise);
      });
      const read = deferred<ReviewedTrip>();
      f.getTrip.mockImplementationOnce(() => {
        // Reentrant global Retry proves retirement happened before the first read call.
        status.retry();
        return read.promise;
      });
      const before = snapshot(f.base);
      const reviewButton = within(d).getByRole("button", { name: "Reload and review" });
      act(() => {
        fireEvent.click(reviewButton);
        fireEvent.click(reviewButton);
        status.retry();
      });
      expect(f.getTrip).toHaveBeenCalledTimes(2);
      expect(f.listStaples).toHaveBeenCalledTimes(2);
      expect(calls(f, kind)).toHaveLength(1);
      expect((reviewButton as HTMLButtonElement).disabled).toBe(true);
      const retryButton = within(d).queryByRole("button", { name: "Retry change" });
      expect(!retryButton || (retryButton as HTMLButtonElement).disabled).toBe(true);
      expect(snapshot(f.base)).toEqual(before);
      await act(async () => read.reject(new Error("fresh read failed")));
      await held();
      // Provider refused discard (other is pending). The retained failed slot must still be inert.
      act(() => status.retry());
      expect(calls(f, kind)).toHaveLength(1);
      await act(async () => {
        other.resolve(null);
        await tracked;
      });
      expect(screen.getByRole("dialog")).toBe(d);
    });
  }

it.each(["return", "bathroom", "optional", "plain"] as const)(
  "successful review replaces the COMPLETE %s view and makes next Save a new intent",
  async (variant) => {
    const f = setup(variant === "return");
    await open(f.source);
    await fail(f, "edit");
    const old = f.editItem.mock.calls[0];
    const fresh = structuredClone(await f.base.getTrip("san-diego"));
    fresh.days = 12;
    fresh.destination = "Reviewed destination";
    const item = fresh.items.find((row) => row.id === "underwear")!;
    Object.assign(item, {
      name: "Reviewed item",
      qty: 24,
      section: variant === "return" ? "return" : "packlast",
      optional: variant === "optional",
      groupId: variant === "bathroom" ? "toiletry-bag" : null,
      stapleCadence: "per night",
      stapleQty: 2,
      laundryHalves: true,
    });
    // Real default CAS changes UUID/version content; explicit fresh read supplies that revision.
    const opening = f.base.staplesSnapshot().find((row) => row.id === "underwear")!;
    await f.base.upsertStaple(
      { ...opening, cadence: "per day", qty: 2, laundryHalves: false },
      opening.revision!,
    );
    const reviewed = f.base.staplesSnapshot().find((row) => row.id === "underwear")!;
    f.getTrip.mockResolvedValueOnce(fresh);
    review();
    await waitFor(() => expect(name().value).toBe("Reviewed item"));
    expect(name().disabled).toBe(false);
    expect((within(editor()).getByLabelText("Quantity") as HTMLInputElement).value).toBe("24");
    expect(
      (within(editor()).getByRole("radio", { name: /This trip only/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(editor().textContent).toContain("Reviewed destination");
    expect(!!within(editor()).queryByText("Return outfit item.")).toBe(variant === "return");
    expect(!!within(editor()).queryByText("Bathroom item.")).toBe(variant === "bathroom");
    expect(!!within(editor()).queryByText("Optional suggestion.")).toBe(variant === "optional");
    expect(!!within(editor()).queryByRole("button", { name: "Remove item" })).toBe(
      variant === "bathroom" || variant === "optional",
    );
    if (variant !== "return")
      expect(
        (within(editor()).getByRole("switch", { name: "Pack last" }) as HTMLInputElement).checked,
      ).toBe(true);
    remember();
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toContain(
      "2 per day",
    );
    expect(f.editItem).toHaveBeenCalledTimes(1);
    fireEvent.change(name(), { target: { value: "Explicit new intent" } });
    click("Save item");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.editItem.mock.calls[1][2]).not.toBe(old[2]);
    expect(f.editItem.mock.calls[1][3]).toEqual(reviewed.revision);
    expect(f.editItem.mock.calls[1][3]).not.toEqual(old[3]);
    expect(f.editItem.mock.calls[1][2]).toEqual({
      name: "Explicit new intent",
      qty: 24,
      timing: variant === "return" ? "return" : "packlast",
      scope: "remember",
    });
  },
);

it("reviewed absence permits only a subsequent explicit new remembered intent with null", async () => {
  const f = setup();
  await open(f.source);
  await fail(f, "edit");
  const opening = f.base.staplesSnapshot().find((row) => row.id === "underwear")!;
  await f.base.removeStaple(opening.id, opening.revision!);
  review();
  await waitFor(() => expect(name().disabled).toBe(false));
  act(() => status.retry());
  expect(f.editItem).toHaveBeenCalledTimes(1);
  remember();
  fireEvent.change(name(), { target: { value: "Explicit recreation" } });
  click("Save item");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(f.editItem.mock.calls[1][3]).toBeNull();
  expect(f.base.staplesSnapshot().find((row) => row.id === "underwear")!.name).toBe(
    "Explicit recreation",
  );
});

it("successful review after failed remove resets confirmation and old global closure cannot replay reviewed deletion", async () => {
  const f = setup();
  await open(f.source, "last-toothbrush");
  await fail(f, "remove");
  const opening = f.base.staplesSnapshot().find((row) => row.id === "last-toothbrush")!;
  await f.base.removeStaple(opening.id, opening.revision!);
  const other = deferred<unknown>();
  let tracked!: Promise<unknown>;
  act(() => {
    tracked = status.track(() => other.promise);
  });
  review();
  await screen.findByRole("dialog", { name: "Edit item" });
  expect(name().value).toBe("Toothbrush");
  expect(
    (within(editor()).getByRole("radio", { name: /This trip only/ }) as HTMLInputElement).checked,
  ).toBe(true);
  act(() => status.retry());
  expect(f.removeItem).toHaveBeenCalledTimes(1);
  expect(f.base.staplesSnapshot().some((row) => row.id === opening.id)).toBe(false);
  await act(async () => {
    other.resolve(null);
    await tracked;
  });
  click("Remove item");
  click("Remove item", screen.getByRole("dialog"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(f.removeItem.mock.calls[1][2]).toBe("this-trip");
  expect(f.removeItem.mock.calls[1][3]).toBeNull();
});

it("reviewed missing trip item closes intentionally and retires the old edit/remove", async () => {
  const f = setup();
  await open(f.source, "last-toothbrush");
  await fail(f, "remove");
  await f.base.removeItem("san-diego", "last-toothbrush", "this-trip");
  review();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  act(() => status.retry());
  expect(f.removeItem).toHaveBeenCalledTimes(1);
});

it.each(["success", "failure"] as const)(
  "closed pending review's late %s cannot overwrite a successor",
  async (outcome) => {
    const f = setup();
    await open(f.source);
    await fail(f, "edit");
    const read = deferred<ReviewedTrip>();
    f.getTrip.mockImplementationOnce(() => read.promise);
    review();
    click("Close dialog");
    await reopen("socks");
    const successor = editor();
    fireEvent.change(name(), { target: { value: "Successor unsaved" } });
    await act(async () => {
      if (outcome === "failure") read.reject(new Error("late read"));
      else read.resolve(await f.base.getTrip("san-diego"));
    });
    expect(editor()).toBe(successor);
    expect(name().value).toBe("Successor unsaved");
    expect(name().disabled).toBe(false);
    act(() => status.retry());
    expect(f.editItem).toHaveBeenCalledTimes(1);
  },
);

it("a delayed background read and late old bag/write cannot replace a successful reviewed generation", async () => {
  const f = setup();
  const first = deferred<TripChange>();
  f.editItem
    .mockReset()
    .mockImplementation(f.base.editItem)
    .mockImplementationOnce(() => first.promise);
  const view = await open(f.source);
  remember();
  click("Save item");
  click("Close dialog");
  await reopen();
  fireEvent.change(name(), { target: { value: "Successor failed draft" } });
  f.editItem.mockRejectedValueOnce(new Error("successor offline"));
  click("Save item");
  await failed();
  const late = deferred<ReviewedTrip>();
  const replacement = { ...f.source, getTrip: vi.fn<TripsSource["getTrip"]>(() => late.promise) };
  vi.spyOn(SourceContext, "useTripsSource").mockImplementation(function useReplacement() {
    originalSource();
    return replacement;
  });
  view.rerender(
    <TripsSourceProvider source={replacement}>
      <TripScreen tripId="san-diego" />
    </TripsSourceProvider>,
  );
  await waitFor(() => expect(replacement.getTrip).toHaveBeenCalledTimes(1));
  replacement.getTrip.mockImplementationOnce(f.base.getTrip);
  review();
  await waitFor(() => expect(name().disabled).toBe(false));
  const reviewed = editor();
  fireEvent.change(name(), { target: { value: "New reviewed generation draft" } });
  const result = await f.base.editItem(...f.editItem.mock.calls[0]);
  result.signals.promptBagPlacement = true;
  await act(async () => {
    first.resolve(result);
    late.resolve(await f.base.getTrip("san-diego"));
  });
  expect(editor()).toBe(reviewed);
  expect(name().value).toBe("New reviewed generation draft");
  expect(name().disabled).toBe(false);
  expect(within(editor()).queryByText(/Couldn’t/)).toBeNull();
});

it("review removes ALL opening return/optional/Bathroom fields and old removability", async () => {
  const f = setup();
  const opening = structuredClone(await f.base.getTrip("san-diego"));
  Object.assign(
    opening.items.find((row) => row.id === "underwear")!,
    { section: "return", optional: true, groupId: "toiletry-bag" },
  );
  f.getTrip.mockResolvedValueOnce(opening);
  await open(f.source);
  await fail(f, "edit");
  review();
  await waitFor(() => expect(name().disabled).toBe(false));
  expect(name().value).toBe("Underwear");
  expect(within(editor()).queryByText("Return outfit item.")).toBeNull();
  expect(within(editor()).queryByText("Bathroom item.")).toBeNull();
  expect(within(editor()).queryByText("Optional suggestion.")).toBeNull();
  expect(within(editor()).queryByRole("button", { name: "Remove item" })).toBeNull();
  expect(
    (within(editor()).getByRole("switch", { name: "Pack last" }) as HTMLInputElement).checked,
  ).toBe(false);
});

it.each([
  ["per day", false, "5 per day"],
  ["per night", false, ""],
  ["per trip", false, ""],
  ["per day", true, ""],
] as const)(
  "explicit reviewed %s laundry=%s controls preview, not opening defaults",
  async (cadence, laundryHalves, text) => {
    const f = setup();
    await open(f.source);
    await fail(f, "edit");
    const fresh = structuredClone(await f.base.getTrip("san-diego"));
    fresh.days = 2;
    fresh.items.find((row) => row.id === "underwear")!.qty = 9;
    f.getTrip.mockResolvedValueOnce(fresh);
    f.listStaples.mockResolvedValueOnce(
      f.base
        .staplesSnapshot()
        .map((row) => (row.id === "underwear" ? { ...row, cadence, laundryHalves } : row)),
    );
    review();
    await waitFor(() => expect(name().disabled).toBe(false));
    remember();
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe(
      text ? `Saved as ${text} for future trips.` : "",
    );
  },
);
