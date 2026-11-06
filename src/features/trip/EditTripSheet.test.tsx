// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { setPacked } from "@/domain/readiness";
import type { TripConfig } from "@/domain/trip";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { EditTripSheet, type ApplyOutcome, type EditTripTab } from "./EditTripSheet";

const base = () => sampleLifecycleState().trips[0];

function setup(
  options: {
    tab?: EditTripTab;
    trip?: ReturnType<typeof base>;
    apply?: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
    saveRoute?: () => Promise<boolean>;
    saveMode?: () => Promise<boolean>;
  } = {},
) {
  const trip = options.trip ?? base();
  const onClose = vi.fn();
  const onApplyPreferences = vi.fn(options.apply ?? (async () => "ok" as const));
  const onSaveRoute = vi.fn(options.saveRoute ?? (async () => true));
  const onSaveTravelMode = vi.fn(options.saveMode ?? (async () => true));
  renderInApp(
    <EditTripSheet
      trip={trip}
      initialTab={options.tab ?? "preferences"}
      onClose={onClose}
      onSaveRoute={onSaveRoute}
      onApplyPreferences={onApplyPreferences}
      onSaveTravelMode={onSaveTravelMode}
    />,
  );
  return {
    trip,
    user: userEvent.setup(),
    dialog: screen.getByRole("dialog", { name: "Edit trip" }),
    onClose,
    onApplyPreferences,
    onSaveRoute,
    onSaveTravelMode,
  };
}

describe("EditTripSheet suitcase editor", () => {
  it("uses the trip name as the visible title and opens the requested section", () => {
    const { dialog } = setup({ tab: "route" });
    expect(within(dialog).getByRole("heading", { name: "San Diego" })).toBeTruthy();
    expect(within(dialog).getByText("Edit trip")).toBeTruthy();
    expect(within(dialog).getByText("Route & dates").closest("details")?.open).toBe(true);
    expect(within(dialog).getByText("Packing preferences").closest("details")?.open).toBe(false);
  });

  it("shows the preference and item changes live and Undo all clears them", async () => {
    const { user, dialog, trip } = setup();
    await user.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    const review = within(dialog).getByRole("region", { name: "What changes in your list" });
    expect(within(review).getByText("Laundry")).toBeTruthy();
    expect(within(review).getByText("Everyday tops")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Save \d+ changes/ })).toBeTruthy();
    await user.click(within(review).getByRole("button", { name: "Undo all" }));
    expect(within(review).getByText("No changes yet.")).toBeTruthy();
    expect(within(dialog).getByRole("switch", { name: "Laundry on this trip" })).toHaveProperty(
      "checked",
      trip.config.laundry,
    );
  });

  it("persists preferences and travel mode through the single Save action", async () => {
    const { user, dialog, trip, onApplyPreferences, onSaveTravelMode, onClose } = setup();
    await user.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    await user.click(within(dialog).getByRole("radio", { name: "Drive" }));
    await user.click(within(dialog).getByRole("button", { name: /Save \d+ changes/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplyPreferences).toHaveBeenCalledWith(
      { ...trip.config, laundry: !trip.config.laundry },
      trip.updatedAt,
    );
    expect(onSaveTravelMode).toHaveBeenCalledWith("drive");
  });

  it("requires acknowledgement before a packed count is reduced", async () => {
    const trip = setPacked(base(), "tops", 4).trip;
    const { user, dialog } = setup({ trip: { ...base(), ...trip } });
    await user.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    const save = within(dialog).getByRole("button", { name: /Save \d+ changes/ });
    expect(save).toHaveProperty("disabled", true);
    expect(within(dialog).getByText(/Packed 4 → 2/)).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: /I understand/ }));
    expect(save).toHaveProperty("disabled", false);
  });

  it("keeps selections and explains a stale save", async () => {
    const { user, dialog } = setup({ apply: async () => "stale" });
    await user.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    await user.click(within(dialog).getByRole("button", { name: /Save \d+ changes/ }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/list changed/i);
    expect(within(dialog).getByRole("switch", { name: "Laundry on this trip" })).toHaveProperty(
      "checked",
      true,
    );
  });

  it("keeps disabled Nice controls linked to their explanation", async () => {
    const { user, dialog } = setup();
    await user.click(within(dialog).getByRole("switch", { name: "Nice outfits" }));
    const occasions = within(dialog).getByLabelText("Occasions") as HTMLInputElement;
    expect(occasions.disabled).toBe(true);
    const hint = within(dialog).getByText("Turn on Nice outfits to set occasions.");
    expect(occasions.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("clamps occasions to the supported range", () => {
    const { dialog } = setup();
    const occasions = within(dialog).getByLabelText("Occasions") as HTMLInputElement;
    fireEvent.change(occasions, { target: { value: "12" } });
    expect(occasions.value).toBe("8");
    fireEvent.change(occasions, { target: { value: "0" } });
    expect(occasions.value).toBe("1");
  });

  it("Cancel and close leave every callback untouched", async () => {
    const { user, dialog, onClose, onApplyPreferences, onSaveRoute } = setup();
    await user.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplyPreferences).not.toHaveBeenCalled();
    expect(onSaveRoute).not.toHaveBeenCalled();
  });
});
