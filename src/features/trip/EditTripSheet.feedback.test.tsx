// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { EditTripSheet, type EditTripTab, type SaveResult } from "./EditTripSheet";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));
const openReport = vi.fn();
vi.mock("@/features/feedback/FeedbackAccess", () => ({
  useFeedbackAccess: () => ({ available: true, status: { canCapture: true }, openReport }),
}));

const base = (): LifecycleTrip => sampleLifecycleState().trips[0];

function setup(tab: EditTripTab, saveMode: () => Promise<SaveResult> = async () => ({})) {
  renderInApp(
    <EditTripSheet
      trip={base()}
      initialTab={tab}
      onClose={() => {}}
      onSaveRoute={async () => ({})}
      onSetTravelMode={saveMode}
      onApplyPreferences={async () => "ok"}
    />,
  );
  return screen.getByRole("dialog", { name: "Edit trip" });
}

const entry = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Send feedback" });

describe("EditTripSheet: Feedback entry (#296)", () => {
  it("is in the header with either section open, before the close button", async () => {
    const dialog = setup("route");
    const head = dialog.querySelector(".modal-head") as HTMLElement;
    expect(head.contains(entry(dialog))).toBe(true);
    expect(
      entry(dialog).compareDocumentPosition(
        within(dialog).getByRole("button", { name: "Close dialog" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Packing preferences" }));
    expect(entry(dialog)).toBeTruthy();
  });

  it("is still there beside the live changes, and opens the report", async () => {
    const dialog = setup("preferences");
    await userEvent.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    expect(within(dialog).getByRole("button", { name: /^Save \d+ changes$/ })).toBeTruthy();
    await userEvent.click(entry(dialog));
    expect(openReport).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the editor is saving", async () => {
    let finish: (value: SaveResult) => void = () => {};
    const dialog = setup("route", () => new Promise<SaveResult>((resolve) => (finish = resolve)));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Drive" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save 1 change" }));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(true);
    finish(null);
  });
});
