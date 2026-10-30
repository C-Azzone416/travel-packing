// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { Trip } from "@/domain/trip";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { EditTripSheet, type EditTripTab } from "./EditTripSheet";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));
const openReport = vi.fn();
vi.mock("@/features/feedback/FeedbackAccess", () => ({
  useFeedbackAccess: () => ({ available: true, status: { canCapture: true }, openReport }),
}));

const base = (): Trip => sampleLifecycleState().trips[0];

function setup(tab: EditTripTab, saveRoute: () => Promise<boolean> = async () => true) {
  renderInApp(
    <EditTripSheet
      trip={base()}
      initialTab={tab}
      onClose={() => {}}
      onSaveRoute={saveRoute}
      onApplyPreferences={async () => "ok"}
    />,
  );
  return screen.getByRole("dialog", { name: "Edit trip" });
}

const entry = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Send feedback" });

describe("EditTripSheet: Feedback entry (#296)", () => {
  it("is in the header on the Route tab and the Preferences tab, before the close button", async () => {
    const dialog = setup("route");
    const head = dialog.querySelector(".modal-head") as HTMLElement;
    expect(head.contains(entry(dialog))).toBe(true);
    expect(
      entry(dialog).compareDocumentPosition(
        within(dialog).getByRole("button", { name: "Close dialog" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Packing preferences" }));
    expect(entry(dialog)).toBeTruthy();
  });

  it("is still there on the Apply (review) step, and opens the report", async () => {
    const dialog = setup("preferences");
    await userEvent.click(within(dialog).getByRole("switch", { name: "Laundry access" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Review changes" }));
    expect(within(dialog).getByRole("button", { name: "Apply changes" })).toBeTruthy();
    await userEvent.click(entry(dialog));
    expect(openReport).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the editor is saving", async () => {
    let finish: (value: boolean) => void = () => {};
    const dialog = setup("route", () => new Promise<boolean>((resolve) => (finish = resolve)));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save route" }));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(true);
    finish(false);
  });
});
