// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { EditTripSheet, type EditTripTab } from "./EditTripSheet";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));
const openReport = vi.fn();
vi.mock("@/features/feedback/FeedbackAccess", () => ({
  useFeedbackAccess: () => ({ available: true, status: { canCapture: true }, openReport }),
}));

const base = () => sampleLifecycleState().trips[0];

function setup(tab: EditTripTab, apply: () => Promise<"ok" | "failed"> = async () => "ok") {
  renderInApp(
    <EditTripSheet
      trip={base()}
      initialTab={tab}
      onClose={() => {}}
      onSaveRoute={async () => true}
      onApplyPreferences={apply}
    />,
  );
  return screen.getByRole("dialog", { name: "Edit trip" });
}

const entry = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Send feedback" });

describe("EditTripSheet: Feedback entry (#296)", () => {
  it("is in the header before the close button for either opening section", () => {
    const dialog = setup("route");
    const head = dialog.querySelector(".modal-head") as HTMLElement;
    expect(head.contains(entry(dialog))).toBe(true);
    expect(
      entry(dialog).compareDocumentPosition(
        within(dialog).getByRole("button", { name: "Close dialog" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(entry(dialog)).toBeTruthy();
  });

  it("stays available beside the live review and opens the report", async () => {
    const dialog = setup("preferences");
    expect(within(dialog).getByRole("region", { name: "What changes in your list" })).toBeTruthy();
    await userEvent.click(entry(dialog));
    expect(openReport).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the editor is saving", async () => {
    let finish: (value: "ok") => void = () => {};
    const dialog = setup("preferences", () => new Promise<"ok">((resolve) => (finish = resolve)));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(within(dialog).getByRole("switch", { name: "Laundry on this trip" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Save \d+ changes/ }));
    expect((entry(dialog) as HTMLButtonElement).disabled).toBe(true);
    finish("ok");
  });
});
