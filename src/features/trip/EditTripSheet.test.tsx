// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { calculateSuggestions } from "@/domain/calc";
import { recalculateSuggestions } from "@/domain/item-ops";
import { setPacked } from "@/domain/readiness";
import type { Trip, TripConfig } from "@/domain/trip";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { EditTripSheet, type ApplyOutcome, type EditTripTab } from "./EditTripSheet";

const base = (): Trip => sampleLifecycleState().trips[0]; // San Diego: Nice outfits on, 1 occasion, return outfit on

function setup(
  options: {
    trip?: Trip;
    tab?: EditTripTab;
    apply?: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
    saveRoute?: () => Promise<boolean>;
  } = {},
) {
  const trip = options.trip ?? base();
  const onClose = vi.fn();
  const onApplyPreferences = vi.fn(options.apply ?? (async () => "ok" as const));
  const onSaveRoute = vi.fn(options.saveRoute ?? (async () => true));
  const user = userEvent.setup();
  renderInApp(
    <EditTripSheet
      trip={trip}
      initialTab={options.tab ?? "preferences"}
      onClose={onClose}
      onSaveRoute={onSaveRoute}
      onApplyPreferences={onApplyPreferences}
    />,
  );
  const dialog = () => screen.getByRole("dialog", { name: "Edit trip" });
  return { user, trip, dialog, onClose, onApplyPreferences, onSaveRoute };
}

const toggle = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("switch", { name }) as HTMLInputElement;

describe("EditTripSheet: tabs", () => {
  it("is one Edit trip dialog with Route & dates and Packing preferences tabs, opening on the one asked for", () => {
    setup({ tab: "preferences" });
    const tabs = screen.getByRole("tablist", { name: "What to edit" });
    const route = within(tabs).getByRole("tab", { name: "Route & dates" });
    const prefs = within(tabs).getByRole("tab", { name: "Packing preferences" });
    expect(prefs.getAttribute("aria-selected")).toBe("true");
    expect(route.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel", { name: "Packing preferences" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Route & dates" })).toBeNull(); // the other panel is hidden
  });

  it("opens on Route & dates from the dashboard", () => {
    setup({ tab: "route" });
    expect(screen.getByRole("tab", { name: "Route & dates" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("group", { name: /^Stop 1$|^Destination/ }) ?? true).toBeTruthy();
  });

  it("the arrow keys, Home and End move between the tabs and focus follows", async () => {
    const { user } = setup({ tab: "route" });
    const route = screen.getByRole("tab", { name: "Route & dates" });
    const prefs = screen.getByRole("tab", { name: "Packing preferences" });
    route.focus();
    await user.keyboard("{ArrowRight}");
    expect(prefs.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(prefs);
    await user.keyboard("{ArrowRight}");
    expect(route.getAttribute("aria-selected")).toBe("true"); // wraps
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(prefs);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(route);
    // Only the selected tab is in the tab order.
    expect(route.tabIndex).toBe(0);
    expect(prefs.tabIndex).toBe(-1);
  });

  it("each tab keeps its own unsaved draft when you switch, and marks it", async () => {
    const { user, dialog } = setup({ tab: "preferences" });
    await user.click(toggle(dialog(), "Laundry access"));
    expect(
      within(screen.getByRole("tab", { name: /Packing preferences/ })).getByLabelText(
        /unsaved changes/,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Route & dates" }));
    await user.click(screen.getByRole("tab", { name: /Packing preferences/ }));
    expect(toggle(dialog(), "Laundry access").checked).toBe(true);
  });
});

describe("EditTripSheet: the Packing preferences tab", () => {
  it("is pre-filled from the trip's saved configuration, all six fields", () => {
    const trip: Trip = {
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
    expect(toggle(dialog(), "Laundry access").checked).toBe(true);
    expect(toggle(dialog(), "One spare underwear + socks").checked).toBe(false);
    expect(toggle(dialog(), "Nice outfits").checked).toBe(true);
    expect((within(dialog()).getByLabelText("Occasions") as HTMLInputElement).value).toBe("4");
    expect(toggle(dialog(), "Reuse one nice look").checked).toBe(false);
    expect(toggle(dialog(), "Dedicated return travel outfit").checked).toBe(false);
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

  it("shows the live count line for the draft", async () => {
    const { user, dialog } = setup();
    const line = () => within(dialog()).getByText(/How we count:/).parentElement?.textContent ?? "";
    expect(line()).toContain("everyday clothes");
    const before = line();
    await user.click(toggle(dialog(), "Dedicated return travel outfit"));
    expect(line()).not.toBe(before);
  });

  it("Review changes is off with 'No changes to apply' until something changes", async () => {
    const { user, dialog } = setup();
    const review = within(dialog()).getByRole("button", {
      name: "Review changes",
    }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    expect(within(dialog()).getByText("No changes to apply")).toBeTruthy();
    await user.click(toggle(dialog(), "Laundry access"));
    expect(review.disabled).toBe(false);
    await user.click(toggle(dialog(), "Laundry access"));
    expect(review.disabled).toBe(true);
  });
});

describe("EditTripSheet: cancel, Escape and × change nothing", () => {
  it("closes at once when nothing was changed", async () => {
    const { user, onClose, onApplyPreferences, onSaveRoute } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplyPreferences).not.toHaveBeenCalled();
    expect(onSaveRoute).not.toHaveBeenCalled();
  });

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
    "with edits, %s asks 'Discard your changes?' in the footer first; Keep editing keeps them, Discard closes",
    async (_name, leave) => {
      const { user, dialog, onClose, onApplyPreferences } = setup();
      await user.click(toggle(dialog(), "Laundry access"));
      await leave(user);
      expect(onClose).not.toHaveBeenCalled();
      expect(within(dialog()).getByText("Discard your changes?")).toBeTruthy();
      await user.click(within(dialog()).getByRole("button", { name: "Keep editing" }));
      expect(within(dialog()).queryByText("Discard your changes?")).toBeNull();
      expect(toggle(dialog(), "Laundry access").checked).toBe(true);
      await leave(user);
      await user.click(within(dialog()).getByRole("button", { name: "Discard" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onApplyPreferences).not.toHaveBeenCalled();
    },
  );
});

describe("EditTripSheet: the review", () => {
  const review = async (
    user: ReturnType<typeof userEvent.setup>,
    change: (dialog: HTMLElement) => Promise<void>,
    dialog: () => HTMLElement,
  ) => {
    await change(dialog());
    await user.click(within(dialog()).getByRole("button", { name: "Review changes" }));
  };

  it("lists what changes in plain words, groups it, and counts it, before anything is applied", async () => {
    const { user, dialog, onApplyPreferences } = setup();
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    const sheet = dialog();
    expect(
      within(sheet).getByRole("heading", { name: "Review changes to your list" }),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Review changes to your list");
    expect(
      within(sheet).getByText(
        /We’ll recalculate the suggested items|we’ll recalculate the suggested items/,
      ),
    ).toBeTruthy();
    const updated = within(sheet).getByRole("region", { name: "Updated suggestions" });
    expect(within(updated).getByText(/Everyday tops:/).textContent).toMatch(/\d+ → \d+/);
    expect(within(sheet).getByText(/\d+ updated/, { selector: "li" })).toBeTruthy();
    expect(onApplyPreferences).not.toHaveBeenCalled();
  });

  it("a packed count above the new target is shown, needs an acknowledgement, and Apply stays off until it is ticked", async () => {
    const trip = setPacked(base(), "tops", 3).trip;
    const { user, dialog, onApplyPreferences } = setup({ trip });
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    const sheet = dialog();
    expect(within(sheet).getByText(/Packed 3 → 2/)).toBeTruthy();
    expect(within(sheet).getByText(/packed count is lowered to the new target/)).toBeTruthy();
    const apply = within(sheet).getByRole("button", { name: "Apply changes" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await user.click(
      within(sheet).getByRole("checkbox", { name: /I understand packed counts above will change/ }),
    );
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    await waitFor(() => expect(onApplyPreferences).toHaveBeenCalledTimes(1));
  });

  it("applies exactly the selections, based on the trip's updatedAt, and closes", async () => {
    const trip = { ...base(), updatedAt: "2026-10-16T10:00:00.000Z" };
    const { user, dialog, onApplyPreferences, onClose } = setup({ trip });
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    await user.click(within(dialog()).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplyPreferences).toHaveBeenCalledWith(
      { ...trip.config, laundry: !trip.config.laundry },
      "2026-10-16T10:00:00.000Z",
    );
  });

  it("with nothing risky there is no acknowledgement; with nothing to change it says so", async () => {
    const { user, dialog } = setup();
    await review(user, async (d) => user.click(toggle(d, "One spare underwear + socks")), dialog);
    expect(within(dialog()).queryByRole("checkbox")).toBeNull();
    expect(
      (within(dialog()).getByRole("button", { name: "Apply changes" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("turning Nice outfits off lists the removed items with Packed and Edited tags and the remembered note", async () => {
    const packed = setPacked(base(), "nice-shoes", 1).trip;
    const { user, dialog } = setup({ trip: packed });
    await review(user, async (d) => user.click(toggle(d, "Nice outfits")), dialog);
    const removed = within(dialog()).getByRole("region", {
      name: /Removed because of your new preferences/,
    });
    expect(within(removed).getByText(/Dress shoes/)).toBeTruthy();
    expect(within(removed).getAllByText("Packed").length).toBeGreaterThan(0);
    expect(
      within(removed).getByText(/These are remembered\. Turn the preference back on/),
    ).toBeTruthy();
    // A packed item is removed, so the acknowledgement appears.
    expect(within(dialog()).getByRole("checkbox", { name: /I understand/ })).toBeTruthy();
  });

  it("lists the user's own work under 'Stay as you left them', and suppressed suggestions as not re-added", async () => {
    const withWork: Trip = {
      ...base(),
      items: [
        ...base().items,
        {
          id: "custom-camera",
          name: "Camera",
          category: "Tech",
          qty: 1,
          packed: 0,
          section: "main",
        },
      ],
      suppressedSuggestions: { "nice-shoes": true },
    };
    const { user, dialog } = setup({ trip: withWork });
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    const stay = within(dialog())
      .getByText(/Stay as you left them/)
      .closest("details") as HTMLElement;
    expect(within(stay).getByText(/Camera/)).toBeTruthy();
    expect(within(stay).getByText(/Not re-added: Dress shoes/)).toBeTruthy();
  });

  it("'Also changes': Ready turns off only for a Ready trip, and the bag resets only when Bathroom items change", async () => {
    const readyAndPlaced: Trip = { ...base(), ready: true, toiletryBagPacked: true };
    const { user, dialog } = setup({ trip: readyAndPlaced });
    await review(user, async (d) => user.click(toggle(d, "Nice outfits")), dialog);
    expect(within(dialog()).getByText("Ready turns off.")).toBeTruthy();
    expect(within(dialog()).getByText(/Toiletry bag placement resets/)).toBeTruthy();
    expect(within(dialog()).getByText(/−Makeup/)).toBeTruthy();
  });

  it("no 'Also changes' strip for a trip that is not Ready and whose Bathroom items stay", async () => {
    const { user, dialog } = setup();
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    expect(within(dialog()).queryByText("Also changes")).toBeNull();
  });

  it("Back to preferences returns with every selection intact", async () => {
    const { user, dialog } = setup();
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    await user.click(within(dialog()).getByRole("button", { name: "Back to preferences" }));
    expect(toggle(dialog(), "Laundry access").checked).toBe(!base().config.laundry);
  });

  it("the preview is exactly what the recalculation makes: the same list the server will save", async () => {
    // The review is built from recalculateSuggestions, so the item counts it reports match applying it.
    const trip = base();
    const next = recalculateSuggestions(
      trip,
      { ...trip.config, laundry: true },
      calculateSuggestions,
    );
    const { user, dialog } = setup();
    await review(user, async (d) => user.click(toggle(d, "Laundry access")), dialog);
    const tops = next.items.find((item) => item.id === "tops")!;
    const from = trip.items.find((item) => item.id === "tops")!;
    expect(within(dialog()).getByText(`${from.qty} → ${tops.qty}`)).toBeTruthy();
  });
});

describe("EditTripSheet: errors keep the selections", () => {
  it("a failed apply stays in the review with a message and Try again, and the selections are kept", async () => {
    let attempts = 0;
    const { user, dialog, onApplyPreferences, onClose } = setup({
      apply: async () => (++attempts === 1 ? "failed" : "ok"),
    });
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    await user.click(within(dialog()).getByRole("button", { name: "Review changes" }));
    await user.click(within(dialog()).getByRole("button", { name: "Apply changes" }));
    expect(await within(dialog()).findByText(/Couldn’t apply the changes/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplyPreferences).toHaveBeenCalledTimes(2);
  });

  it("a stale review sends you back to the preferences with a message, selections kept", async () => {
    const { user, dialog, onClose } = setup({ apply: async () => "stale" });
    await user.click(toggle(dialog(), "Laundry access"));
    await user.click(within(dialog()).getByRole("button", { name: "Review changes" }));
    await user.click(within(dialog()).getByRole("button", { name: "Apply changes" }));
    expect(
      await within(dialog()).findByText(
        "Your list changed while you were reviewing. Review again.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog()).queryByRole("heading", { name: "Review changes to your list" }),
    ).toBeNull();
    expect(toggle(dialog(), "Laundry access").checked).toBe(!base().config.laundry);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Apply is single-shot while it is in flight", async () => {
    let finish!: (value: ApplyOutcome) => void;
    const { user, dialog, onApplyPreferences } = setup({
      apply: () => new Promise<ApplyOutcome>((resolve) => (finish = resolve)),
    });
    await user.click(toggle(dialog(), "One spare underwear + socks"));
    await user.click(within(dialog()).getByRole("button", { name: "Review changes" }));
    const apply = within(dialog()).getByRole("button", { name: "Apply changes" });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(onApplyPreferences).toHaveBeenCalledTimes(1);
    expect(
      within(dialog()).getByRole("button", { name: "Applying…" }).getAttribute("aria-busy"),
    ).toBe("true");
    await act(async () => finish("ok"));
  });
});

describe("EditTripSheet: the Route & dates tab", () => {
  it("saves the route, then closes when the preferences tab has nothing unsaved", async () => {
    const { user, onSaveRoute, onClose } = setup({ tab: "route" });
    await user.click(screen.getByRole("button", { name: "Save route" }));
    await waitFor(() => expect(onSaveRoute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stays open on the Packing preferences tab after saving the route when it has unsaved changes there", async () => {
    const { user, dialog, onClose } = setup({ tab: "preferences" });
    await user.click(toggle(dialog(), "Laundry access"));
    await user.click(screen.getByRole("tab", { name: "Route & dates" }));
    await user.click(screen.getByRole("button", { name: "Save route" }));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /Packing preferences/ }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(toggle(dialog(), "Laundry access").checked).toBe(!base().config.laundry);
  });

  it("says so, and stays open, when the route does not save", async () => {
    const { user, dialog, onClose } = setup({ tab: "route", saveRoute: async () => false });
    await user.click(screen.getByRole("button", { name: "Save route" }));
    expect(await within(dialog()).findByText(/Couldn’t save the route/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
