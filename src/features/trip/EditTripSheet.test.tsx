// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { setPacked } from "@/domain/readiness";
import type { TripConfig } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TravelMode } from "@/domain/trip-route";
import type { TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  EditTripSheet,
  type ApplyOutcome,
  type EditTripTab,
  type SaveResult,
} from "./EditTripSheet";

const base = (): LifecycleTrip => ({
  ...sampleLifecycleState().trips[0], // San Diego, 5 days: Nice outfits on, 1 occasion, return outfit on
  updatedAt: "T1",
});

interface Options {
  trip?: LifecycleTrip;
  tab?: EditTripTab;
  today?: string;
  apply?: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
  saveRoute?: (stops: TripStop[], basedOn?: string) => Promise<SaveResult>;
  setMode?: (mode: TravelMode, basedOn?: string) => Promise<SaveResult>;
}

function setup(options: Options = {}) {
  const onClose = vi.fn();
  const onApplyPreferences = vi.fn(options.apply ?? (async () => "ok" as const));
  const onSaveRoute = vi.fn(options.saveRoute ?? (async () => ({ updatedAt: "T2" })));
  const onSetTravelMode = vi.fn(options.setMode ?? (async () => ({ updatedAt: "T3" })));
  const user = userEvent.setup();
  const trip = options.trip ?? base();
  renderInApp(
    <EditTripSheet
      trip={trip}
      initialTab={options.tab ?? "preferences"}
      today={options.today ?? "2026-10-01"}
      onClose={onClose}
      onSaveRoute={onSaveRoute}
      onSetTravelMode={onSetTravelMode}
      onApplyPreferences={onApplyPreferences}
    />,
  );
  const dialog = () => screen.getByRole("dialog", { name: "Edit trip" });
  return { user, trip, dialog, onClose, onApplyPreferences, onSaveRoute, onSetTravelMode };
}

const toggle = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("switch", { name }) as HTMLInputElement;
const SAVE = { name: /^Save \d+ changes?$/ };
const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", SAVE) as HTMLButtonElement;
const rowsOf = (dialog: HTMLElement) =>
  within(within(dialog).getByRole("list", { name: "What changes in your list" })).getAllByRole(
    "listitem",
  );

describe("EditTripSheet: the sheet", () => {
  it("is one Edit trip dialog named for the trip, with the Feedback-free head and a close button", () => {
    const { dialog } = setup();
    expect(within(dialog()).getByRole("heading", { name: "Edit trip", level: 2 })).toBeTruthy();
    expect(dialog().getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(dialog().getAttribute("aria-describedby")!)?.textContent).toBe(
      "San Diego",
    );
    expect(dialog().className).toContain("modal-side");
    expect(within(dialog()).getByRole("button", { name: "Close dialog" })).toBeTruthy();
  });

  it("opens the section asked for, and each section opens and closes (aria-expanded)", async () => {
    const { user, dialog } = setup({ tab: "preferences" });
    const route = within(dialog()).getByRole("button", { name: "Route & dates" });
    const prefs = within(dialog()).getByRole("button", { name: "Packing preferences" });
    expect(prefs.getAttribute("aria-expanded")).toBe("true");
    expect(route.getAttribute("aria-expanded")).toBe("false");
    expect(within(dialog()).getByRole("region", { name: "Packing preferences" })).toBeTruthy();
    expect(within(dialog()).queryByRole("region", { name: "Route & dates" })).toBeNull(); // hidden
    await user.click(route);
    expect(route.getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog()).getByRole("region", { name: "Route & dates" })).toBeTruthy();
    await user.click(prefs);
    expect(within(dialog()).queryByRole("region", { name: "Packing preferences" })).toBeNull();
    expect(route.getAttribute("aria-controls")).toBe(
      within(dialog()).getByRole("region", { name: "Route & dates" }).id,
    );
  });

  it("opens on Route & dates from the dashboard", () => {
    setup({ tab: "route" });
    expect(
      screen.getByRole("button", { name: "Route & dates" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("San Diego", { selector: "span" })).toBeTruthy();
  });

  it("puts a dot on an edited section and takes it away when the edit is reverted", async () => {
    const { user, dialog } = setup({ tab: "preferences" });
    const prefs = within(dialog()).getByRole("button", { name: /Packing preferences/ });
    expect(within(prefs).queryByRole("img")).toBeNull();
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(within(prefs).getByRole("img", { name: "edited, not saved yet" })).toBeTruthy();
    const route = within(dialog()).getByRole("button", { name: /Route & dates/ });
    expect(within(route).queryByRole("img")).toBeNull();
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(within(prefs).queryByRole("img")).toBeNull();
  });

  it("marks Route & dates when only how you are getting there changed", async () => {
    const { user, dialog } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    expect(
      within(within(dialog()).getByRole("button", { name: /Route & dates/ })).getByRole("img"),
    ).toBeTruthy();
    expect(
      within(within(dialog()).getByRole("button", { name: /Packing preferences/ })).queryByRole(
        "img",
      ),
    ).toBeNull();
  });
});

describe("EditTripSheet: What changes in your list", () => {
  it("starts with 'No changes yet.', a disabled Save changes and no Undo all", () => {
    const { dialog } = setup();
    expect(
      within(dialog()).getByText("No changes yet.", { selector: "p:not(.sr-only)" }),
    ).toBeTruthy();
    const save = within(dialog()).getByRole("button", {
      name: "Save changes",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(dialog()).queryByRole("button", { name: "Undo all" })).toBeNull();
    expect(
      within(dialog()).getByText(/Items you added or edited yourself stay as they are/),
    ).toBeTruthy();
  });

  it("updates live as you edit: old struck, new bold, N changes on the button, announced politely", async () => {
    const { user, dialog } = setup();
    await user.click(toggle(dialog(), "Laundry on this trip"));
    const list = rowsOf(dialog());
    expect(list.length).toBeGreaterThan(1);
    expect(within(list[0]).getByText("Laundry")).toBeTruthy();
    expect(list[0].querySelector("del")?.textContent).toBe("off");
    expect(list[0].querySelector("ins")?.textContent).toBe("on");
    // The item rows follow the preference, old → new in quantities.
    const tops = list.find((entry) => entry.textContent?.startsWith("Everyday tops"))!;
    expect(tops.querySelector("del")?.textContent).toMatch(/^× \d+$/);
    expect(tops.querySelector("ins")?.textContent).toMatch(/^× \d+$/);
    expect(saveButton(dialog()).textContent).toBe(`Save ${list.length} changes`);
    expect(within(dialog()).getByRole("status", { name: "Changes summary" }).textContent).toBe(
      `${list.length} changes to save.`,
    );
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    expect(saveButton(dialog()).textContent).toBe(`Save ${rowsOf(dialog()).length} changes`);
    expect(rowsOf(dialog()).length).toBeGreaterThan(list.length - 1);
  });

  it("says 'Save 1 change' for a single change", async () => {
    const { user, dialog } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("radio", { name: "Fly" }));
    expect(within(dialog()).getByRole("button", { name: "Save 1 change" })).toBeTruthy();
    expect(within(dialog()).getByRole("status", { name: "Changes summary" }).textContent).toBe(
      "1 change to save.",
    );
  });

  it("'already packed · add N more' appears for a packed line that grows", async () => {
    const full = base();
    const tops = full.items.find((item) => item.id === "tops")!;
    const packed = { ...setPacked(full, "tops", tops.qty).trip, updatedAt: "T1" } as LifecycleTrip;
    const { user, dialog } = setup({ trip: packed });
    await user.click(toggle(dialog(), "Dedicated return travel outfit")); // one more everyday day
    expect(within(dialog()).getByText(/^Already packed · add \d+ more$/)).toBeTruthy();
  });

  it("Undo all puts every field back, clears the dots and the rows", async () => {
    const { user, dialog } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(within(dialog()).getByRole("button", { name: "One night more" }));
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(within(dialog()).getAllByRole("img", { name: "edited, not saved yet" })).toHaveLength(2);
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    expect(within(dialog()).queryAllByRole("img", { name: "edited, not saved yet" })).toHaveLength(
      0,
    );
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(false);
    expect((within(dialog()).getByLabelText("Come home") as HTMLInputElement).value).toBe(
      base().end,
    );
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Undo all" })).toBeNull();
    expect(
      (within(dialog()).getByRole("radio", { name: "Drive" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("See what moves toggles the list on a phone: open while short, closed while long, the person's choice wins", async () => {
    const { user, dialog } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    const moves = within(dialog()).getByRole("button", { name: /See what moves/ });
    expect(moves.getAttribute("aria-expanded")).toBe("true"); // 1 row
    await user.click(moves);
    expect(moves.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.getElementById(moves.getAttribute("aria-controls")!)?.hasAttribute("data-open"),
    ).toBe(false);
    await user.click(moves);
    expect(moves.getAttribute("aria-expanded")).toBe("true");
    // Many rows: collapsed by default.
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(toggle(dialog(), "Dedicated return travel outfit"));
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    expect(rowsOf(dialog()).length).toBeGreaterThan(3);
  });

  it("a trip counted with the earlier rule offers to bring itself up to date with nothing edited", async () => {
    const stale: LifecycleTrip = {
      ...base(),
      dailyDays: 3,
      items: base().items.map((item) => (item.id === "tops" ? { ...item, qty: 3 } : item)),
    };
    const { user, dialog, onApplyPreferences, onClose, trip } = setup({ trip: stale });
    expect(rowsOf(dialog()).length).toBe(1);
    expect(within(rowsOf(dialog())[0]).getByText("Everyday tops")).toBeTruthy();
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplyPreferences).toHaveBeenCalledWith(trip.config, "T1");
  });

  it("Ready turns off and the packed count that drops need a tick before Save is possible", async () => {
    const ready: LifecycleTrip = {
      ...(setPacked(base(), "tops", 3).trip as LifecycleTrip),
      updatedAt: "T1",
      ready: true,
    };
    const { user, dialog, onApplyPreferences } = setup({ trip: ready });
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(within(dialog()).getByText("Packed 3 → 2")).toBeTruthy();
    expect(within(dialog()).getByText(/^Ready turns off/)).toBeTruthy();
    expect(saveButton(dialog()).disabled).toBe(true);
    await user.click(
      within(dialog()).getByRole("checkbox", {
        name: /I understand packed counts above will change/,
      }),
    );
    expect(saveButton(dialog()).disabled).toBe(false);
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onApplyPreferences).toHaveBeenCalledTimes(1));
  });

  it("Undo all drops a tick that was given", async () => {
    const packed = { ...(setPacked(base(), "tops", 3).trip as LifecycleTrip), updatedAt: "T1" };
    const { user, dialog } = setup({ trip: packed });
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(within(dialog()).getByRole("checkbox", { name: /I understand/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(
      (within(dialog()).getByRole("checkbox", { name: /I understand/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
});

describe("EditTripSheet: Cancel, Escape and × leave the trip untouched", () => {
  it.each([
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Cancel" })),
    ],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    [
      "the × button",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Close dialog" })),
    ],
  ])(
    "%s closes at once, even with edits: nothing was saved, so nothing is asked",
    async (_n, leave) => {
      const { user, dialog, onClose, onApplyPreferences, onSaveRoute, onSetTravelMode } = setup();
      await user.click(toggle(dialog(), "Laundry on this trip"));
      await leave(user);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onApplyPreferences).not.toHaveBeenCalled();
      expect(onSaveRoute).not.toHaveBeenCalled();
      expect(onSetTravelMode).not.toHaveBeenCalled();
    },
  );

  it("a press on the scrim closes when nothing was changed, and is ignored when there are edits", async () => {
    const { user, dialog, onClose } = setup();
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(toggle(dialog(), "Laundry on this trip"));
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EditTripSheet: Save N changes", () => {
  it("saves the route, then how you are travelling, then the preferences, each based on the save time before", async () => {
    const order: string[] = [];
    const { user, dialog, onClose, onSaveRoute, onSetTravelMode, onApplyPreferences, trip } = setup(
      {
        tab: "route",
        saveRoute: async () => {
          order.push("route");
          return { updatedAt: "T2" };
        },
        setMode: async () => {
          order.push("mode");
          return { updatedAt: "T3" };
        },
        apply: async () => {
          order.push("prefs");
          return "ok";
        },
      },
    );
    await user.click(within(dialog()).getByRole("button", { name: "One night more" }));
    await user.click(within(dialog()).getByRole("radio", { name: "Train or other" }));
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["route", "mode", "prefs"]);
    const stops = onSaveRoute.mock.calls[0][0];
    expect(stops).toHaveLength(1);
    expect(stops[0].leave).toBe("2026-10-28");
    expect(onSaveRoute.mock.calls[0][1]).toBe("T1");
    expect(onSetTravelMode).toHaveBeenCalledWith("other", "T2");
    expect(onApplyPreferences).toHaveBeenCalledWith({ ...trip.config, laundry: true }, "T3");
  });

  it("calls only what changed, and keeps the old save time when a host does not report one", async () => {
    const { user, dialog, onClose, onSaveRoute, onSetTravelMode, onApplyPreferences } = setup({
      setMode: async () => ({}),
    });
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaveRoute).not.toHaveBeenCalled();
    expect(onSetTravelMode).not.toHaveBeenCalled();
    expect(onApplyPreferences.mock.calls[0][1]).toBe("T1");
    // A mode save with no reported time passes the earlier one on.
  });

  it("a mode-only change reaches the server and nothing else", async () => {
    const { user, dialog, onClose, onSaveRoute, onApplyPreferences, onSetTravelMode } = setup({
      tab: "route",
      setMode: async () => ({}),
    });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSetTravelMode).toHaveBeenCalledWith("drive", "T1");
    expect(onSaveRoute).not.toHaveBeenCalled();
    expect(onApplyPreferences).not.toHaveBeenCalled();
  });

  it("a route that does not save says so, stops there and keeps every edit", async () => {
    const { user, dialog, onClose, onSetTravelMode, onApplyPreferences } = setup({
      tab: "route",
      saveRoute: async () => null,
    });
    await user.click(within(dialog()).getByRole("button", { name: "One night more" }));
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(saveButton(dialog()));
    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t save the route/);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSetTravelMode).not.toHaveBeenCalled();
    expect(onApplyPreferences).not.toHaveBeenCalled();
    expect(
      (within(dialog()).getByRole("radio", { name: "Drive" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(saveButton(dialog()).disabled).toBe(false);
  });

  it("a travel mode that does not save says so and stops before the preferences", async () => {
    const { user, dialog, onClose, onApplyPreferences } = setup({
      tab: "route",
      setMode: async () => null,
    });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(saveButton(dialog()));
    expect((await within(dialog()).findByRole("alert")).textContent).toMatch(
      /Couldn’t save how you’re getting there/,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onApplyPreferences).not.toHaveBeenCalled();
  });

  it("failed preferences keep the selections, and Save again tries again", async () => {
    let attempts = 0;
    const { user, dialog, onClose, onApplyPreferences } = setup({
      apply: async () => (++attempts === 1 ? "failed" : "ok"),
    });
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    await user.click(saveButton(dialog()));
    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t apply the changes/);
    // The message sits in the pinned panel, never inside the scrolling body.
    expect(alert.closest("[role='region']")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(toggle(dialog(), "One spare underwear + socks").checked).toBe(false);
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplyPreferences).toHaveBeenCalledTimes(2);
  });

  it("a stale save says the list moved on, keeps the selections and stays open", async () => {
    const { user, dialog, onClose } = setup({ apply: async () => "stale" });
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(saveButton(dialog()));
    expect(
      await within(dialog()).findByText(/Your list changed while you were editing/),
    ).toBeTruthy();
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is single-shot while it is in flight, and says Saving…", async () => {
    let finish!: (value: ApplyOutcome) => void;
    const { user, dialog, onApplyPreferences } = setup({
      apply: () => new Promise<ApplyOutcome>((resolve) => (finish = resolve)),
    });
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    const save = saveButton(dialog());
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onApplyPreferences).toHaveBeenCalledTimes(1);
    const busy = within(dialog()).getByRole("button", { name: "Saving…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    // Escape does not abandon a save in flight, and Cancel and Undo all wait too.
    await user.keyboard("{Escape}");
    expect(
      (within(dialog()).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog()).getByRole("button", { name: "Undo all" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => finish("ok"));
  });
});

describe("EditTripSheet: version checks and edits during a save (#389 round 2)", () => {
  it("a route save the server refuses as stale stops the chain, keeps the edits and says the list moved on", async () => {
    const { user, dialog, onClose, onSetTravelMode, onApplyPreferences } = setup({
      tab: "route",
      saveRoute: async () => "stale",
    });
    await user.click(within(dialog()).getByRole("button", { name: "One night more" }));
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(saveButton(dialog()));
    expect(
      await within(dialog()).findByText(/Your list changed while you were editing/),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSetTravelMode).not.toHaveBeenCalled();
    expect(onApplyPreferences).not.toHaveBeenCalled();
    expect(
      (within(dialog()).getByRole("radio", { name: "Drive" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("a travel-mode save refused as stale stops before the preferences", async () => {
    const { user, dialog, onClose, onApplyPreferences } = setup({
      tab: "route",
      setMode: async () => "stale",
    });
    await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    await user.click(saveButton(dialog()));
    expect(
      await within(dialog()).findByText(/Your list changed while you were editing/),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onApplyPreferences).not.toHaveBeenCalled();
  });

  it("the edit controls are inert while the save is pending, and open again after a failure", async () => {
    let finish!: (value: ApplyOutcome) => void;
    const { user, dialog } = setup({
      apply: () => new Promise<ApplyOutcome>((resolve) => (finish = resolve)),
    });
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    const body = dialog().querySelector("[data-edit-body]") as HTMLElement;
    expect(body.hasAttribute("inert")).toBe(false);
    await user.click(saveButton(dialog()));
    expect(body.hasAttribute("inert")).toBe(true);
    await act(async () => finish("failed"));
    await within(dialog()).findByRole("alert");
    expect(body.hasAttribute("inert")).toBe(false);
  });

  it("a press on the scrim does not discard a blank 'Add a stop' (dirty, but no change row yet)", async () => {
    const { user, dialog, onClose } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("button", { name: "Add a stop" }));
    expect(within(dialog()).getByRole("button", { name: "Undo all" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EditTripSheet: the phone list starts folded when it would cover more than 45% of the screen", () => {
  const heights = (list: number, rest: number) => {
    const offset = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get");
    // The panel is `rest` tall without its list; the list is `list` tall natural and shown at its current size.
    offset.mockImplementation(function (this: HTMLElement) {
      return this.dataset.open !== undefined || this.id.endsWith("-rows") ? 0 : rest;
    });
    scroll.mockImplementation(function (this: HTMLElement) {
      return this.id.endsWith("-rows") ? list : 0;
    });
    return () => {
      offset.mockRestore();
      scroll.mockRestore();
    };
  };

  it("folded when panel + list exceed 45% of the viewport, open when they fit, and the person's toggle wins", async () => {
    const restore = heights(400, 300); // 700 of a 768px viewport
    try {
      const { user, dialog } = setup({ tab: "route" });
      await user.click(within(dialog()).getByRole("radio", { name: "Drive" })); // a short list: 1 row
      const moves = within(dialog()).getByRole("button", { name: /See what moves/ });
      expect(moves.getAttribute("aria-expanded")).toBe("false");
      await user.click(moves);
      expect(moves.getAttribute("aria-expanded")).toBe("true");
      await user.click(within(dialog()).getByRole("radio", { name: "Fly" }));
      await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
      expect(moves.getAttribute("aria-expanded")).toBe("true"); // still the person's choice
    } finally {
      restore();
    }
  });

  it("open when panel + list fit within 45% of the viewport", async () => {
    const fits = heights(20, 200); // 220 of 768
    try {
      const { user, dialog } = setup({ tab: "route" });
      await user.click(within(dialog()).getByRole("radio", { name: "Drive" }));
      expect(
        within(dialog())
          .getByRole("button", { name: /See what moves/ })
          .getAttribute("aria-expanded"),
      ).toBe("true");
    } finally {
      fits();
    }
  });
});

describe("EditTripSheet: Route & dates", () => {
  it("fills Leave and Come home from the route, and says the nights", () => {
    const { dialog } = setup({ tab: "route" });
    expect((within(dialog()).getByLabelText("Leave") as HTMLInputElement).value).toBe(base().start);
    expect((within(dialog()).getByLabelText("Come home") as HTMLInputElement).value).toBe(
      base().end,
    );
    expect(within(dialog()).getByText("4 nights")).toBeTruthy();
  });

  it("Leave moves the whole trip; Come home changes its end; the Dates row says both", async () => {
    const { user, dialog } = setup({ tab: "route" });
    fireEvent.change(within(dialog()).getByLabelText("Leave"), { target: { value: "2026-10-22" } });
    expect((within(dialog()).getByLabelText("Come home") as HTMLInputElement).value).toBe(
      "2026-10-26",
    );
    expect(within(dialog()).getByText("Dates")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    fireEvent.change(within(dialog()).getByLabelText("Come home"), {
      target: { value: "2026-10-30" },
    });
    expect(within(dialog()).getByText("4 → 7 nights")).toBeTruthy();
    expect(within(dialog()).getByText("7 nights")).toBeTruthy();
  });

  it("the − and + next to Come home change the nights, and − stops at a day trip", async () => {
    const { user, dialog } = setup({ tab: "route" });
    const less = within(dialog()).getByRole("button", {
      name: "One night fewer",
    }) as HTMLButtonElement;
    const more = within(dialog()).getByRole("button", { name: "One night more" });
    await user.click(more);
    expect(within(dialog()).getByText("5 nights")).toBeTruthy();
    for (let i = 0; i < 5; i += 1) await user.click(less);
    expect(within(dialog()).getByText("day trip")).toBeTruthy();
    expect(less.disabled).toBe(true);
  });

  it("cut down to a day trip, the laundry row is disabled and says why; longer again, it works (#412)", async () => {
    const { user, dialog } = setup({ tab: "route" });
    const less = within(dialog()).getByRole("button", { name: "One night fewer" });
    const more = within(dialog()).getByRole("button", { name: "One night more" });
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    expect(toggle(dialog(), "Laundry on this trip").disabled).toBe(false);
    expect(within(dialog()).queryByText("No effect on a trip this short.")).toBeNull();
    for (let i = 0; i < 4; i += 1) await user.click(less);
    expect(toggle(dialog(), "Laundry on this trip").disabled).toBe(true);
    expect(within(dialog()).getByText("No effect on a trip this short.")).toBeTruthy();
    for (let i = 0; i < 4; i += 1) await user.click(more);
    expect(toggle(dialog(), "Laundry on this trip").disabled).toBe(false);
  });

  it("a NEW laundry opt-in that becomes ineffective is neither listed nor saved; the Dates row says one date (#412)", async () => {
    const { user, dialog, onApplyPreferences, onSaveRoute } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("button", { name: /Packing preferences/ }));
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(true);
    const less = within(dialog()).getByRole("button", { name: "One night fewer" });
    for (let i = 0; i < 4; i += 1) await user.click(less);
    // Disabled, and off as far as the list and the save are concerned.
    expect(toggle(dialog(), "Laundry on this trip").disabled).toBe(true);
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(false);
    const text = rowsOf(dialog()).map((row) => row.textContent ?? "");
    expect(text.some((row) => row.startsWith("Laundry"))).toBe(false);
    const dates = text.find((row) => row.startsWith("Dates"))!;
    expect(dates).not.toMatch(/(\d+ \w+) – \1/);
    const tick = within(dialog()).queryByRole("checkbox", { name: /packed|understand|OK/i });
    if (tick) await user.click(tick);
    await user.click(saveButton(dialog()));
    await waitFor(() => expect(onSaveRoute).toHaveBeenCalled());
    expect(onApplyPreferences.mock.calls.every(([config]) => config.laundry === false)).toBe(true);
  });

  it("How we count follows the dates being edited, not the saved ones (#412)", async () => {
    const { user, dialog } = setup({ tab: "route" });
    const line = () => within(dialog()).getByText(/How we count:/).parentElement?.textContent ?? "";
    expect(line()).toMatch(/5 days away/);
    const less = within(dialog()).getByRole("button", { name: "One night fewer" });
    for (let i = 0; i < 4; i += 1) await user.click(less);
    expect(line()).toMatch(/A day trip/);
  });

  it("a SAVED laundry-on can still be turned off on a day trip (#412)", async () => {
    const trip = base();
    const { user, dialog, onApplyPreferences } = setup({
      trip: { ...trip, config: { ...trip.config, laundry: true } },
    });
    await user.click(within(dialog()).getByRole("button", { name: "Route & dates" }));
    const less = within(dialog()).getByRole("button", { name: "One night fewer" });
    for (let i = 0; i < 4; i += 1) await user.click(less);
    expect(toggle(dialog(), "Laundry on this trip").disabled).toBe(false);
    await user.click(toggle(dialog(), "Laundry on this trip"));
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(false);
    expect(onApplyPreferences).not.toHaveBeenCalled();
  });

  it("a Come home before Leave is a problem in words, and Save waits", async () => {
    const { user, dialog } = setup({ tab: "route" });
    fireEvent.change(within(dialog()).getByLabelText("Come home"), {
      target: { value: "2026-10-01" },
    });
    expect(
      within(dialog()).getByText(/San Diego: Stay at least one night|San Diego: Choose a date/),
    ).toBeTruthy();
    expect(within(dialog()).getByText("Fix 1 thing above to save.")).toBeTruthy();
    expect(
      (within(dialog()).getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(within(dialog()).getByRole("button", { name: "Undo all" }));
    expect(within(dialog()).queryByText(/Fix 1 thing/)).toBeNull();
  });

  it("adds a stop with the keyboard-friendly picker; the new stop is a row once it has a place", async () => {
    const { user, dialog } = setup({ tab: "route" });
    await user.click(within(dialog()).getByRole("button", { name: "Add a stop" }));
    expect(within(dialog()).getByText("Pick a place for Stop 2, or choose Custom.")).toBeTruthy();
    await user.type(
      within(dialog()).getByRole("combobox", { name: "Destination search, Stop 2" }),
      "lisbon",
    );
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    const row = rowsOf(dialog()).find((entry) => entry.textContent?.startsWith("Lisbon"))!;
    expect(row.textContent).toContain("new stop");
    expect(within(dialog()).getByText("Its forecast appears 16 days out")).toBeTruthy();
    expect(within(dialog()).getAllByRole("button", { name: /^Move .* (up|down)$/ }).length).toBe(4);
  });

  it("removes a stop and shows it as removed, with packed items staying ticked", async () => {
    const trip: LifecycleTrip = {
      ...base(),
      end: "2026-10-29",
      stops: [
        { ...base().stops[0], leave: "2026-10-26" },
        {
          location: {
            ...base().stops[0].location,
            id: "pt-lisbon",
            city: "Lisbon",
            label: "Lisbon, Portugal",
          },
          arrive: "2026-10-26",
          leave: "2026-10-29",
        },
      ],
    };
    const { user, dialog } = setup({ trip, tab: "route" });
    await user.click(within(dialog()).getByRole("button", { name: "Move Lisbon up" }));
    expect(within(dialog()).getByText("reordered")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Remove Lisbon" }));
    expect(within(dialog()).getByText("removed")).toBeTruthy();
    expect(within(dialog()).getByText("Items you packed for it stay ticked")).toBeTruthy();
  });

  function Harness({
    change,
    tab,
  }: {
    change: (trip: LifecycleTrip) => LifecycleTrip;
    tab: EditTripTab;
  }) {
    const [trip, setTrip] = useState(base());
    return (
      <>
        <button type="button" onClick={() => setTrip(change(trip))}>
          saved elsewhere
        </button>
        <EditTripSheet
          trip={trip}
          initialTab={tab}
          today="2026-10-01"
          onClose={() => {}}
          onSaveRoute={async () => ({})}
          onSetTravelMode={async () => ({})}
          onApplyPreferences={async () => "ok"}
        />
      </>
    );
  }
  const elsewhere = () =>
    fireEvent.click(screen.getByRole("button", { name: "saved elsewhere", hidden: true }));

  it("when the trip changes under the sheet, an edited Come home is kept and the concurrent Leave change is taken", async () => {
    const user = userEvent.setup();
    renderInApp(
      <Harness
        tab="route"
        change={(trip) => ({
          ...trip,
          start: "2026-10-21",
          stops: [{ ...trip.stops[0], arrive: "2026-10-21", leave: "2026-10-27" }],
          end: "2026-10-27",
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "One night more" })); // Come home 10-28
    elsewhere();
    expect((screen.getByLabelText("Leave") as HTMLInputElement).value).toBe("2026-10-21");
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-28");
    // The rows are rebased on the new server state: the dates row is old (21-27 Oct) -> new, and Save counts it.
    expect(screen.getByText("6 → 7 nights")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save \d+ changes?$/ })).toBeTruthy();
  });

  it("removing a stop is not a Come home edit: a concurrent later Come home is kept and sent with the fresh save time", async () => {
    const user = userEvent.setup();
    const lisbon = {
      ...base().stops[0].location,
      id: "pt-lisbon",
      city: "Lisbon",
      label: "Lisbon, Portugal",
    };
    const twoStops = (end: string): LifecycleTrip => ({
      ...base(),
      end,
      stops: [
        { ...base().stops[0], arrive: "2026-10-23", leave: "2026-10-26" },
        { location: lisbon, arrive: "2026-10-26", leave: end },
      ],
    });
    const onSaveRoute = vi.fn<(stops: TripStop[], basedOn?: string) => Promise<SaveResult>>(
      async () => ({
        updatedAt: "T3",
      }),
    );
    function Removing() {
      const [trip, setTrip] = useState(twoStops("2026-10-29"));
      return (
        <>
          <button
            type="button"
            onClick={() => setTrip({ ...twoStops("2026-10-31"), updatedAt: "T2" })}
          >
            saved elsewhere
          </button>
          <EditTripSheet
            trip={trip}
            initialTab="route"
            today="2026-10-01"
            onClose={() => {}}
            onSaveRoute={onSaveRoute}
            onSetTravelMode={async () => ({})}
            onApplyPreferences={async () => "ok"}
          />
        </>
      );
    }
    renderInApp(<Removing />);
    await user.click(screen.getByRole("button", { name: "Remove Lisbon" }));
    elsewhere();
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-31");
    await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
    expect(onSaveRoute).toHaveBeenCalledTimes(1);
    const [sent, basedOn] = onSaveRoute.mock.calls[0];
    expect(basedOn).toBe("T2");
    expect(sent.map((stop) => stop.location.id)).toEqual([base().stops[0].location.id]);
    expect(sent[0].leave).toBe("2026-10-31");
  });

  function renderAdding() {
    const sandiego = (end: string): LifecycleTrip => ({
      ...base(),
      end,
      stops: [{ ...base().stops[0], arrive: "2026-10-23", leave: end }],
    });
    const onSaveRoute = vi.fn<(stops: TripStop[], basedOn?: string) => Promise<SaveResult>>(
      async () => ({ updatedAt: "T3" }),
    );
    function Adding() {
      const [trip, setTrip] = useState(sandiego("2026-10-27"));
      return (
        <>
          <button
            type="button"
            onClick={() => setTrip({ ...sandiego("2026-10-31"), updatedAt: "T2" })}
          >
            saved elsewhere
          </button>
          <EditTripSheet
            trip={trip}
            initialTab="route"
            today="2026-10-01"
            onClose={() => {}}
            onSaveRoute={onSaveRoute}
            onSetTravelMode={async () => ({})}
            onApplyPreferences={async () => "ok"}
          />
        </>
      );
    }
    renderInApp(<Adding />);
    return onSaveRoute;
  }
  async function addLisbon(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    await user.type(screen.getByRole("combobox", { name: "Destination search, Stop 2" }), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
  }

  it("adding a stop is not a Come home edit: a concurrent later Come home is kept and sent with the fresh save time", async () => {
    const user = userEvent.setup();
    const onSaveRoute = renderAdding();
    await addLisbon(user);
    elsewhere();
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-31");
    await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
    const [sent, basedOn] = onSaveRoute.mock.calls[0];
    expect(basedOn).toBe("T2");
    expect(sent.length).toBe(2);
    expect(sent[1].leave).toBe("2026-10-31");
  });

  it("a Come home the person set on top of an added stop beats the concurrent one", async () => {
    const user = userEvent.setup();
    const onSaveRoute = renderAdding();
    await addLisbon(user);
    fireEvent.change(screen.getByLabelText("Come home"), { target: { value: "2026-10-29" } });
    elsewhere();
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-29");
    await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
    expect(onSaveRoute.mock.calls[0][0][1].leave).toBe("2026-10-29");
  });

  it("a Come home or Leave put back to its saved date is no longer the person's: a later stop edit takes the concurrent dates", async () => {
    const user = userEvent.setup();
    const lisbon = {
      ...base().stops[0].location,
      id: "pt-lisbon",
      city: "Lisbon",
      label: "Lisbon, Portugal",
    };
    const twoStops = (start: string, end: string): LifecycleTrip => ({
      ...base(),
      start,
      end,
      stops: [
        { ...base().stops[0], arrive: start, leave: "2026-10-26" },
        { location: lisbon, arrive: "2026-10-26", leave: end },
      ],
    });
    const onSaveRoute = vi.fn<(stops: TripStop[], basedOn?: string) => Promise<SaveResult>>(
      async () => ({ updatedAt: "T3" }),
    );
    function Reverting({ elsewhereTrip }: { elsewhereTrip: LifecycleTrip }) {
      const [trip, setTrip] = useState(twoStops("2026-10-23", "2026-10-29"));
      return (
        <>
          <button type="button" onClick={() => setTrip({ ...elsewhereTrip, updatedAt: "T2" })}>
            saved elsewhere
          </button>
          <EditTripSheet
            trip={trip}
            initialTab="route"
            today="2026-10-01"
            onClose={() => {}}
            onSaveRoute={onSaveRoute}
            onSetTravelMode={async () => ({})}
            onApplyPreferences={async () => "ok"}
          />
        </>
      );
    }
    const setDate = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    // Come home: 30 Oct, back to 29 Oct; remove Lisbon; the server's trip now ends 31 Oct.
    const { unmount } = renderInApp(
      <Reverting elsewhereTrip={twoStops("2026-10-23", "2026-10-31")} />,
    );
    setDate("Come home", "2026-10-30");
    setDate("Come home", "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Remove Lisbon" }));
    elsewhere();
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-31");
    await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
    expect(onSaveRoute.mock.calls[0][1]).toBe("T2");
    expect(onSaveRoute.mock.calls[0][0][0].leave).toBe("2026-10-31");
    unmount();
    // Leave: 24 Oct, back to 23 Oct; remove San Diego; the server's trip now starts 21 Oct.
    renderInApp(<Reverting elsewhereTrip={twoStops("2026-10-21", "2026-10-29")} />);
    setDate("Leave", "2026-10-24");
    setDate("Leave", "2026-10-23");
    await user.click(screen.getByRole("button", { name: "Remove San Diego" }));
    const leaveAfterRemoval = (screen.getByLabelText("Leave") as HTMLInputElement).value;
    elsewhere();
    expect(leaveAfterRemoval).not.toBe("");
    expect((screen.getByLabelText("Leave") as HTMLInputElement).value).toBe("2026-10-21");
  });

  describe("a refresh that agrees with the person's date settles it", () => {
    const lisbon = {
      ...base().stops[0].location,
      id: "pt-lisbon",
      city: "Lisbon",
      label: "Lisbon, Portugal",
    };
    const twoStops = (start: string, end: string, updatedAt: string): LifecycleTrip => ({
      ...base(),
      start,
      end,
      updatedAt,
      stops: [
        { ...base().stops[0], arrive: start, leave: "2026-10-26" },
        { location: lisbon, arrive: "2026-10-26", leave: end },
      ],
    });
    const oneStop = (start: string, end: string, updatedAt: string): LifecycleTrip => ({
      ...base(),
      start,
      end,
      updatedAt,
      stops: [{ ...base().stops[0], arrive: start, leave: end }],
    });
    const setDate = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const field = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

    it("Come home: saved and echoed back, then a stop-only edit takes the next concurrent date", async () => {
      const user = userEvent.setup();
      // What the server answers after each of the two saves (the sheet is re-fed these as the stale reload).
      const reloads = [
        twoStops("2026-10-23", "2026-10-30", "T2"),
        oneStop("2026-10-23", "2026-10-31", "T3"),
      ];
      const calls: [TripStop[], string | undefined][] = [];
      function TwoSaves() {
        const [trip, setTrip] = useState(twoStops("2026-10-23", "2026-10-29", "T1"));
        return (
          <EditTripSheet
            trip={trip}
            initialTab="route"
            today="2026-10-01"
            onClose={() => {}}
            onSaveRoute={async (stops, basedOn) => {
              calls.push([stops, basedOn]);
              const next = reloads.shift()!;
              setTrip(next);
              return { updatedAt: next.updatedAt };
            }}
            onSetTravelMode={async () => ({})}
            onApplyPreferences={async () => "ok"}
          />
        );
      }
      renderInApp(<TwoSaves />);
      setDate("Come home", "2026-10-30");
      await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
      await waitFor(() => expect(calls.length).toBe(1));
      expect(field("Come home")).toBe("2026-10-30"); // settled: the server agrees
      await user.click(screen.getByRole("button", { name: "Remove Lisbon" }));
      await user.click(screen.getByRole("button", { name: /^Save \d+ changes?$/ }));
      await waitFor(() => expect(calls.length).toBe(2));
      expect(calls[1][1]).toBe("T2");
      // The reload after the second save brought Oct 31 (T3): the person's Oct 30 was settled, so the server's date is taken.
      expect(field("Come home")).toBe("2026-10-31");
    });

    function renderRefreshing(initial: LifecycleTrip, reload: LifecycleTrip) {
      const onSaveRoute = vi.fn<(stops: TripStop[], basedOn?: string) => Promise<SaveResult>>(
        async () => ({ updatedAt: "T9" }),
      );
      function Refreshing() {
        const [trip, setTrip] = useState(initial);
        return (
          <>
            <button type="button" onClick={() => setTrip(reload)}>
              saved elsewhere
            </button>
            <EditTripSheet
              trip={trip}
              initialTab="route"
              today="2026-10-01"
              onClose={() => {}}
              onSaveRoute={onSaveRoute}
              onSetTravelMode={async () => ({})}
              onApplyPreferences={async () => "ok"}
            />
          </>
        );
      }
      renderInApp(<Refreshing />);
      return onSaveRoute;
    }
    const save = () => screen.getByRole("button", { name: /^Save \d+ changes?$/ });

    it("a departure-only edit keeps the concurrent Come home, also after the return was put back by hand", async () => {
      const user = userEvent.setup();
      const onSaveRoute = renderRefreshing(
        oneStop("2026-10-23", "2026-10-27", "T1"),
        oneStop("2026-10-23", "2026-10-31", "T2"),
      );
      setDate("Leave", "2026-10-22");
      setDate("Come home", "2026-10-27"); // the baseline date again: not an edit
      elsewhere();
      expect(field("Leave")).toBe("2026-10-22");
      expect(field("Come home")).toBe("2026-10-31");
      await user.click(save());
      const [sent, basedOn] = onSaveRoute.mock.calls[0];
      expect([sent[0].arrive, sent[0].leave, basedOn]).toEqual(["2026-10-22", "2026-10-31", "T2"]);
    });

    it("a stop edit that puts the return back at the baseline settles it, so removing a stop later takes the concurrent return", async () => {
      const user = userEvent.setup();
      const onSaveRoute = renderRefreshing(
        oneStop("2026-10-23", "2026-10-27", "T1"),
        oneStop("2026-10-23", "2026-10-31", "T2"),
      );
      setDate("Come home", "2026-10-26");
      await addLisbon(user); // Lisbon's default night: the return is back at the Oct 27 baseline
      expect(field("Come home")).toBe("2026-10-27");
      await user.click(screen.getByRole("button", { name: "Remove San Diego" }));
      elsewhere();
      expect(field("Come home")).toBe("2026-10-31");
      await user.click(save());
      expect(onSaveRoute.mock.calls[0][0].at(-1)?.leave).toBe("2026-10-31");
      expect(onSaveRoute.mock.calls[0][1]).toBe("T2");
    });

    it("Leave: an active Leave edit survives a stop removal and a concurrent earlier Leave", async () => {
      const user = userEvent.setup();
      function Active() {
        const [trip, setTrip] = useState(twoStops("2026-10-23", "2026-10-29", "T1"));
        return (
          <>
            <button
              type="button"
              onClick={() => setTrip(oneStop("2026-10-21", "2026-10-31", "T2"))}
            >
              saved elsewhere
            </button>
            <EditTripSheet
              trip={trip}
              initialTab="route"
              today="2026-10-01"
              onClose={() => {}}
              onSaveRoute={async () => ({})}
              onSetTravelMode={async () => ({})}
              onApplyPreferences={async () => "ok"}
            />
          </>
        );
      }
      renderInApp(<Active />);
      setDate("Leave", "2026-10-22");
      await user.click(screen.getByRole("button", { name: "Remove San Diego" }));
      elsewhere();
      expect(field("Leave")).toBe("2026-10-22");
      expect(field("Come home")).toBe("2026-10-31");
    });
  });

  it("an untouched route follows the server; the dot and count clear when nothing of the person's remains", async () => {
    renderInApp(
      <Harness
        tab="route"
        change={(trip) => ({
          ...trip,
          end: "2026-10-30",
          stops: [{ ...trip.stops[0], leave: "2026-10-30" }],
        })}
      />,
    );
    elsewhere();
    expect((screen.getByLabelText("Come home") as HTMLInputElement).value).toBe("2026-10-30");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryAllByRole("img", { name: "edited, not saved yet" })).toHaveLength(0);
  });

  it("when another device changes Spare, an untouched Spare takes it and an edited Laundry is kept", async () => {
    const user = userEvent.setup();
    renderInApp(
      <Harness
        tab="preferences"
        change={(trip) => ({ ...trip, config: { ...trip.config, spare: false } })}
      />,
    );
    await user.click(
      toggle(screen.getByRole("dialog", { name: "Edit trip" }), "Laundry on this trip"),
    );
    elsewhere();
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    expect(toggle(dialog, "One spare underwear + socks").checked).toBe(false);
    expect(toggle(dialog, "Laundry on this trip").checked).toBe(true);
    // The diff is against the new server state: only Laundry is offered, not a reversal of the other device's change.
    expect(within(dialog).queryByText("Spare underwear + socks")).toBeNull();
    expect(within(dialog).getByText("Laundry")).toBeTruthy();
  });

  it("a preference toggled and toggled back is untouched, so the server value wins", async () => {
    const user = userEvent.setup();
    renderInApp(
      <Harness
        tab="preferences"
        change={(trip) => ({ ...trip, config: { ...trip.config, spare: false, laundry: true } })}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(toggle(dialog, "One spare underwear + socks"));
    await user.click(toggle(dialog, "One spare underwear + socks")); // back at the baseline
    elsewhere();
    expect(toggle(dialog, "One spare underwear + socks").checked).toBe(false);
    expect(toggle(dialog, "Laundry on this trip").checked).toBe(true);
  });

  it("Getting there starts on the saved mode", () => {
    const { dialog } = setup({ trip: { ...base(), travelMode: "drive" }, tab: "route" });
    expect(
      (within(dialog()).getByRole("radio", { name: "Drive" }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("EditTripSheet: Packing preferences", () => {
  it("is pre-filled from the trip's saved configuration, all six fields", () => {
    const trip: LifecycleTrip = {
      ...base(),
      config: {
        laundry: true,
        spare: false,
        niceAttire: true,
        occasionCount: 4,
        reuseNice: false,
        returnOutfit: false,
      },
    };
    const { dialog } = setup({ trip });
    expect(toggle(dialog(), "Laundry on this trip").checked).toBe(true);
    expect(toggle(dialog(), "One spare underwear + socks").checked).toBe(false);
    expect(toggle(dialog(), "Nice outfits").checked).toBe(true);
    expect((within(dialog()).getByLabelText("Occasions") as HTMLInputElement).value).toBe("4");
    expect(toggle(dialog(), "Reuse one nice look").checked).toBe(false);
    expect(toggle(dialog(), "Dedicated return travel outfit").checked).toBe(false);
    expect(within(dialog()).getByText("Halves anything marked ↻ in your Staples.")).toBeTruthy();
  });

  it("groups the clothing counts and the Nice outfits settings in labelled fieldsets", () => {
    setup();
    expect(screen.getByRole("group", { name: "Clothing counts" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Nice outfits" })).toBeTruthy();
  });

  it("Occasions and Reuse are disabled while Nice outfits is off, say why, and keep their values", async () => {
    const { user, dialog } = setup();
    const occasions = within(dialog()).getByLabelText("Occasions") as HTMLInputElement;
    fireEvent.change(occasions, { target: { value: "3" } });
    await user.click(toggle(dialog(), "Nice outfits"));
    expect(occasions.disabled).toBe(true);
    expect(toggle(dialog(), "Reuse one nice look").disabled).toBe(true);
    const hint = within(dialog()).getByText("Turn on Nice outfits to set occasions.");
    expect(occasions.getAttribute("aria-describedby")).toBe(hint.id);
    await user.click(toggle(dialog(), "Nice outfits"));
    expect(occasions.value).toBe("3");
    expect(within(dialog()).queryByText("Turn on Nice outfits to set occasions.")).toBeNull();
  });

  it("keeps Occasions within 1 and 8", async () => {
    const { user, dialog } = setup();
    const occasions = within(dialog()).getByLabelText("Occasions") as HTMLInputElement;
    await user.clear(occasions);
    await user.type(occasions, "12");
    expect(occasions.value).toBe("8");
    fireEvent.change(occasions, { target: { value: "0" } });
    expect(occasions.value).toBe("1");
  });

  it("How we count switches between the two #295 equations as the return outfit is toggled", async () => {
    const { user, dialog } = setup();
    const line = () => within(dialog()).getByText(/How we count:/).parentElement?.textContent ?? "";
    expect(line()).toBe(
      "How we count: 5 days away − 1 for home = 4 days of everyday clothes. Your travel outfit is worn, not packed.",
    );
    await user.click(toggle(dialog(), "Dedicated return travel outfit"));
    expect(line()).toBe(
      "How we count: 5 days away, none held back for home = 5 days of everyday clothes. Your travel outfit is worn, not packed.",
    );
  });
});

describe("EditTripSheet: focus", () => {
  it("traps focus in the sheet and gives it back to the opener on close", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Edit trip opener
          </button>
          {open ? (
            <EditTripSheet
              trip={base()}
              initialTab="preferences"
              today="2026-10-01"
              onClose={() => setOpen(false)}
              onSaveRoute={async () => ({})}
              onSetTravelMode={async () => ({})}
              onApplyPreferences={async () => "ok"}
            />
          ) : null}
        </>
      );
    }
    renderInApp(<Host />);
    const opener = screen.getByRole("button", { name: "Edit trip opener" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("every control has a name", () => {
    const { dialog } = setup({ tab: "route" });
    for (const control of dialog().querySelectorAll("button, input, select")) {
      const name =
        control.getAttribute("aria-label") ||
        (control as HTMLElement).innerText ||
        control.textContent ||
        (control.id && document.querySelector(`label[for="${control.id}"]`)?.textContent) ||
        control.closest("label")?.textContent ||
        control.getAttribute("aria-labelledby");
      expect(name, control.outerHTML.slice(0, 120)).toBeTruthy();
    }
  });
});
