// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { SaveStatusProvider, useSaveStatus } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import {
  createMemoryTripsSource,
  TripsSourceError,
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
async function open(source: TripsSource, id = "underwear") {
  const view = render(
    <TripsSourceProvider source={source}>
      <TripScreen tripId="san-diego" openItemId={id} />
    </TripsSourceProvider>,
    { wrapper: Shell },
  );
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

it("registers synchronously before same-event duplicate submit/remove and native pending locks", async () => {
  const base = fixture();
  const gate = deferred<TripChange>();
  const edit = vi.fn<TripsSource["editItem"]>(() => gate.promise);
  await open({ ...base, editItem: edit });
  remember();
  fireEvent.change(name(), { target: { value: "One intent" } });
  const form = editor().querySelector("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(edit).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(edit.mock.calls[0][2])).toBe(true);
  expect(Object.isFrozen(edit.mock.calls[0][3])).toBe(true);
  locked();
  await act(async () => gate.reject(new Error("offline")));
  await failed();
  locked();
});

for (const kind of ["edit", "remove"] as const) {
  for (const order of ["local-global", "global-local"] as const) {
    it(`${kind}/${order}: both retries share the original frozen intent and one in-flight write`, async () => {
      const base = fixture();
      const id = kind === "edit" ? "underwear" : "last-toothbrush";
      const token = base.staplesSnapshot().find((row) => row.id === id)!.revision;
      const gate = deferred<TripChange>();
      const edit = vi
        .fn<TripsSource["editItem"]>()
        .mockRejectedValueOnce(new Error("lost before commit"))
        .mockImplementationOnce(() => gate.promise);
      const remove = vi
        .fn<TripsSource["removeItem"]>()
        .mockRejectedValueOnce(new Error("lost before commit"))
        .mockImplementationOnce(() => gate.promise);
      await open({ ...base, editItem: edit, removeItem: remove }, id);
      remember();
      if (kind === "edit") {
        fireEvent.change(name(), { target: { value: "Original failed intent" } });
        click("Save item");
      } else {
        click("Remove item");
        click("Remove item", screen.getByRole("dialog", { name: /Remove Toothbrush/ }));
      }
      await failed();
      const calls = kind === "edit" ? edit.mock.calls : remove.mock.calls;
      const original = calls[0];
      const d = screen.getByRole("dialog");
      expect(original[3]).toEqual(token);
      act(() => {
        if (order === "local-global") {
          click("Retry change", d);
          status.retry();
        } else {
          status.retry();
          click("Retry change", d);
        }
        status.retry();
      });
      expect(calls).toHaveLength(2);
      expect(calls[1][2]).toBe(original[2]);
      expect(calls[1][3]).toBe(original[3]);
      if (kind === "edit") locked();
      else
        expect(
          (within(d).getByRole("button", { name: "Keep item" }) as HTMLButtonElement).disabled,
        ).toBe(true);
      await act(async () =>
        gate.resolve(
          kind === "edit"
            ? await base.editItem(...edit.mock.calls[0])
            : await base.removeItem(...remove.mock.calls[0]),
        ),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      if (kind === "edit")
        expect(base.staplesSnapshot().find((row) => row.id === id)!.name).toBe(
          "Original failed intent",
        );
      else expect(base.staplesSnapshot().some((row) => row.id === id)).toBe(false);
    });
  }
}

it("unrelated success clears global error but keeps failed intent locked and locally retryable", async () => {
  const base = fixture();
  const edit = vi.fn(base.editItem).mockRejectedValueOnce(new Error("offline"));
  await open({ ...base, editItem: edit });
  remember();
  fireEvent.change(name(), { target: { value: "Retained locally" } });
  click("Save item");
  await failed();
  await act(async () => {
    await status.track(() => base.setPacked("san-diego", "socks", 1));
  });
  expect(status.status).toBe("saved");
  locked();
  expect(name().value).toBe("Retained locally");
  act(() => status.retry());
  expect(edit).toHaveBeenCalledTimes(1);
  click("Retry change");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(edit.mock.calls[1][2]).toBe(edit.mock.calls[0][2]);
  expect(edit.mock.calls[1][3]).toBe(edit.mock.calls[0][3]);
});

for (const kind of ["edit", "remove"] as const) {
  describe(`${kind}: original expectation`, () => {
    it("unknown commit/lost reply conservatively conflicts on Retry without another write", async () => {
      const base = fixture();
      const edit = vi.fn<TripsSource["editItem"]>(async (...args) => {
        await base.editItem(...args);
        throw new Error("reply lost");
      });
      const remove = vi.fn<TripsSource["removeItem"]>(async (...args) => {
        await base.removeItem(...args);
        throw new Error("reply lost");
      });
      await open(
        { ...base, editItem: edit, removeItem: remove },
        kind === "remove" ? "last-toothbrush" : "underwear",
      );
      remember();
      if (kind === "edit") {
        fireEvent.change(name(), { target: { value: "Committed once" } });
        click("Save item");
      } else {
        click("Remove item");
        click("Remove item", screen.getByRole("dialog", { name: /Remove Toothbrush/ }));
      }
      await failed();
      const committed = snapshot(base);
      // The second transport attempt uses actual CAS and the exact same original argument objects.
      edit.mockImplementation(base.editItem);
      remove.mockImplementation(base.removeItem);
      const d = screen.getByRole("dialog");
      click("Retry change", d);
      await screen.findByText(/Reload and review before editing/);
      expect(snapshot(base)).toEqual(committed);
      const calls = kind === "edit" ? edit.mock.calls : remove.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][2]).toBe(calls[0][2]);
      expect(calls[1][3]).toBe(calls[0][3]);
      expect(within(d).queryByRole("button", { name: "Retry change" })).toBeNull();
      act(() => status.retry());
      expect(calls).toHaveLength(2);
    });
    it.each(["edit", "delete", "recreate", "absent-create"] as const)(
      "external %s after a failed operation cannot rebase Retry",
      async (external) => {
        const base = fixture();
        const id = kind === "remove" ? "last-toothbrush" : "underwear";
        const opening = base.staplesSnapshot().find((row) => row.id === id)!;
        if (external === "absent-create") await base.removeStaple(id, opening.revision!);
        const edit = vi.fn(base.editItem).mockRejectedValueOnce(new Error("offline"));
        const remove = vi.fn(base.removeItem).mockRejectedValueOnce(new Error("offline"));
        await open({ ...base, editItem: edit, removeItem: remove }, id);
        remember();
        if (kind === "edit") {
          fireEvent.change(name(), { target: { value: "Original" } });
          click("Save item");
        } else {
          click("Remove item");
          click("Remove item", screen.getByRole("dialog", { name: /Remove Toothbrush/ }));
        }
        await failed();
        if (external === "edit")
          await base.upsertStaple({ ...opening, qty: 77 }, opening.revision!);
        else if (external === "absent-create") await base.upsertStaple(opening, null);
        else {
          await base.removeStaple(id, opening.revision!);
          if (external === "recreate") await base.upsertStaple(opening, null);
        }
        const before = snapshot(base);
        const d = screen.getByRole("dialog");
        click("Retry change", d);
        await screen.findByText(/Reload and review before editing/);
        expect(snapshot(base)).toEqual(before);
        const calls = kind === "edit" ? edit.mock.calls : remove.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[1][3]).toBe(calls[0][3]);
        expect(calls[0][3]).toEqual(external === "absent-create" ? null : opening.revision);
        expect(within(d).queryByRole("button", { name: "Retry change" })).toBeNull();
        act(() => status.retry());
        expect(calls).toHaveLength(2);
      },
    );
  });
}

it.each(["STALE", "INVALID_INPUT"] as const)(
  "%s has explicit review/discard guidance and no local/global retry",
  async (error) => {
    const base = fixture();
    const edit = vi.fn(base.editItem).mockRejectedValue(new TripsSourceError(error));
    await open({ ...base, editItem: edit });
    remember();
    click("Save item");
    await screen.findByText(/Reload and review before editing/);
    locked();
    expect(within(editor()).queryByRole("button", { name: "Retry change" })).toBeNull();
    expect(within(editor()).queryByRole("button", { name: "Reload and review" })).not.toBeNull();
    act(() => status.retry());
    expect(edit).toHaveBeenCalledTimes(1);
    click("Discard change and close");
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("same-event removal duplicates are singleflight; failure keeps confirmation locked with useful Close", async () => {
  const base = fixture();
  const gate = deferred<TripChange>();
  const remove = vi.fn<TripsSource["removeItem"]>(() => gate.promise);
  await open({ ...base, removeItem: remove }, "last-toothbrush");
  remember();
  click("Remove item");
  const d = screen.getByRole("dialog", { name: /Remove Toothbrush/ });
  const button = within(d).getByRole("button", { name: "Remove item" });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect((within(d).getByRole("button", { name: "Keep item" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => gate.reject(new Error("offline")));
  await failed();
  expect(d.textContent).toContain("Close discards this unsaved change");
  expect((button as HTMLButtonElement).disabled).toBe(true);
  click("Close dialog", d);
  act(() => status.retry());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["discard", "close", "unmount"] as const)(
  "%s retires exact operation before provider discard refused by another pending write",
  async (action) => {
    const base = fixture();
    const remove = vi.fn(base.removeItem).mockRejectedValueOnce(new Error("offline"));
    const view = await open({ ...base, removeItem: remove }, "last-toothbrush");
    remember();
    click("Remove item");
    click("Remove item", screen.getByRole("dialog", { name: /Remove Toothbrush/ }));
    await failed();
    const gate = deferred<unknown>();
    let other!: Promise<unknown>;
    act(() => {
      other = status.track(() => gate.promise);
    });
    const retryBefore = status.retry;
    if (action === "unmount") view.rerender(<div>Screen removed; provider stays alive</div>);
    else
      click(
        action === "discard" ? "Discard change and close" : "Close dialog",
        screen.getByRole("dialog"),
      );
    // While unrelated work is pending, provider discard deliberately refuses: last failed closure remains.
    act(() => retryBefore());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(base.snapshot().trips[0].items.some((row) => row.id === "last-toothbrush")).toBe(true);
    await act(async () => {
      gate.resolve(null);
      await other;
    });
  },
);

it.each(["success", "failure", "bag"] as const)(
  "pending close/reopen: old late %s cannot replace/mutate/close successor",
  async (outcome) => {
    const base = fixture();
    const gate = deferred<TripChange>();
    const edit = vi.fn<TripsSource["editItem"]>(() => gate.promise);
    await open({ ...base, editItem: edit });
    remember();
    fireEvent.change(name(), { target: { value: "Old intent" } });
    click("Save item");
    click("Close dialog");
    await reopen("socks");
    const successor = editor();
    fireEvent.change(name(), { target: { value: "Successor unsaved" } });
    if (outcome === "failure") await act(async () => gate.reject(new Error("old late failure")));
    else {
      const result = await base.editItem(...edit.mock.calls[0]);
      if (outcome === "bag") result.signals.promptBagPlacement = true;
      await act(async () => gate.resolve(result));
    }
    expect(screen.queryByRole("dialog", { name: "Edit item" })).toBe(successor);
    expect(name().value).toBe("Successor unsaved");
    expect(name().disabled).toBe(false);
    expect(within(successor).queryByRole("button", { name: "Retry change" })).toBeNull();
    act(() => status.retry());
    expect(edit).toHaveBeenCalledTimes(1);
    // Confirmed completion is still accepted: another explicit open sees the old successful result.
    if (outcome !== "failure") {
      click("Close dialog");
      await reopen();
      expect(name().value).toBe("Old intent");
    }
  },
);

it("this-trip pending failure and Retry stay compatible without read revision metadata", async () => {
  const base = fixture();
  const edit = vi.fn(base.editItem).mockRejectedValueOnce(new Error("offline"));
  await open({
    ...base,
    listStaples: async () =>
      base.staplesSnapshot().map((row) => {
        const detached = { ...row };
        delete detached.revision;
        return detached;
      }),
    editItem: edit,
  });
  fireEvent.change(name(), { target: { value: "Only this trip" } });
  click("Save item");
  await failed();
  locked();
  click("Retry change");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(edit.mock.calls[0][2].scope).toBe("this-trip");
  expect(edit.mock.calls[0][3]).toBeUndefined();
  expect(base.staplesSnapshot().find((row) => row.id === "underwear")!.name).toBe("Underwear");
});

it("failed remove remains locally recoverable after unrelated success erased global error", async () => {
  const base = fixture();
  const remove = vi.fn(base.removeItem).mockRejectedValueOnce(new Error("offline"));
  await open({ ...base, removeItem: remove }, "last-toothbrush");
  remember();
  click("Remove item");
  const d = screen.getByRole("dialog", { name: /Remove Toothbrush/ });
  click("Remove item", d);
  await failed();
  await act(async () => {
    await status.track(() => base.setPacked("san-diego", "socks", 1));
  });
  expect(status.status).toBe("saved");
  expect(
    (within(d).getByRole("button", { name: "Remove item" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((within(d).getByRole("button", { name: "Keep item" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  act(() => status.retry());
  expect(remove).toHaveBeenCalledTimes(1);
  click("Retry change", d);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(remove.mock.calls[1][3]).toBe(remove.mock.calls[0][3]);
});

it("remembered remove with missing metadata refuses transport and cannot Retry", async () => {
  const base = fixture();
  const remove = vi.fn(base.removeItem);
  const before = snapshot(base);
  await open(
    {
      ...base,
      listStaples: async () =>
        base.staplesSnapshot().map((row) => {
          const detached = { ...row };
          delete detached.revision;
          return detached;
        }),
      removeItem: remove,
    },
    "last-toothbrush",
  );
  remember();
  click("Remove item");
  const d = screen.getByRole("dialog", { name: /Remove Toothbrush/ });
  click("Remove item", d);
  await screen.findByText(/Reload and review before editing/);
  expect(within(d).queryByRole("button", { name: "Retry change" })).toBeNull();
  act(() => status.retry());
  expect(remove).not.toHaveBeenCalled();
  expect(snapshot(base)).toEqual(before);
});
