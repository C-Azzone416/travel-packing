// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WeatherChange } from "@/domain/weather/diff";
import { ReviewSheet } from "./ReviewSheet";

const changes: WeatherChange[] = [
  {
    kind: "add",
    semanticId: "weather-umbrella",
    title: "Compact umbrella",
    reason: "Rain likely in Cool City, Apr 5–7",
    ruleSignature: "rain",
    userEdited: false,
    item: {
      semanticId: "weather-umbrella",
      name: "Compact umbrella",
      category: "Clothing",
      qty: 1,
      optional: false,
      reason: "Rain likely in Cool City, Apr 5–7",
      ruleSignature: "rain",
    },
  },
  {
    kind: "remove",
    semanticId: "weather-swimsuit",
    title: "Swimsuit",
    reason: "The weather no longer calls for this",
    ruleSignature: "removed",
    userEdited: true,
  },
];

function setup(over: Partial<React.ComponentProps<typeof ReviewSheet>> = {}) {
  const onApply = vi.fn();
  const onSkip = vi.fn();
  const onClose = vi.fn();
  render(
    <ReviewSheet
      open
      changes={changes}
      ready
      saving={false}
      onApply={onApply}
      onSkip={onSkip}
      onClose={onClose}
      {...over}
    />,
  );
  return { onApply, onSkip, onClose };
}

describe("ReviewSheet", () => {
  it("checks ordinary changes, leaves user-edited offers unchecked, and applies selected", async () => {
    const { onApply } = setup();
    const dialog = screen.getByRole("dialog", { name: "Weather changes" });
    const umbrella = within(dialog).getByRole("checkbox", { name: /Add Compact umbrella/ });
    const swimsuit = within(dialog).getByRole("checkbox", { name: /Remove Swimsuit/ });
    expect((umbrella as HTMLInputElement).checked).toBe(true);
    expect((swimsuit as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Offered only:/)).toBeTruthy();
    expect(screen.getByText(/takes this trip out of Ready/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
    expect(onApply).toHaveBeenCalledWith([changes[0]], [changes[1]]);
  });

  it("a single change can be unchecked and checked again", async () => {
    const { onApply } = setup();
    const dialog = screen.getByRole("dialog", { name: "Weather changes" });
    const umbrella = within(dialog).getByRole("checkbox", { name: /Add Compact umbrella/ });
    await userEvent.click(umbrella);
    expect((umbrella as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByRole("button", { name: "Add selected" })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(umbrella);
    expect((umbrella as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add selected (1)" }));
    expect(onApply).toHaveBeenCalledWith([changes[0]], [changes[1]]);
  });

  it("supports select all, indeterminate selection, Skip and close", async () => {
    const { onApply, onSkip, onClose } = setup({ ready: false });
    const all = screen.getByRole("checkbox", { name: "Select all (2)" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    await userEvent.click(all);
    expect(all.checked).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Add selected (2)" }));
    expect(onApply).toHaveBeenCalledWith(changes, []);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledWith(changes);
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows split details, packed caution and an apply failure", () => {
    const split: WeatherChange = {
      kind: "split",
      semanticId: "clothing-split",
      title: "Split clothing by weather",
      reason: "counts",
      ruleSignature: "new",
      userEdited: false,
      clothing: [
        {
          id: "tops-short",
          semanticId: "tops-short",
          name: "Short-sleeve tops",
          category: "Clothing",
          qty: 3,
        },
        {
          id: "bottoms-pants",
          semanticId: "bottoms-pants",
          name: "Pants",
          category: "Clothing",
          qty: 2,
        },
      ],
    };
    setup({ changes: [split], error: true, legacyPacked: true });
    expect(screen.getByText(/Replaces Everyday tops/)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("See the new counts"));
    expect(screen.getByText("Short-sleeve tops 3 · Pants 2")).toBeTruthy();
    expect(screen.getByText(/already packed/)).toBeTruthy();
  });

  it("an update to a trip that is already split says what changes, not that Everyday rows are replaced", () => {
    const update: WeatherChange = {
      kind: "split",
      semanticId: "clothing-split",
      title: "Update clothing split",
      reason: "Short-sleeve tops: 3 → 5",
      ruleSignature: "newer",
      userEdited: false,
      clothing: [
        {
          id: "tops-short",
          semanticId: "tops-short",
          name: "Short-sleeve tops",
          category: "Clothing",
          qty: 5,
        },
      ],
    };
    setup({ changes: [update] });
    expect(screen.getByText("Short-sleeve tops: 3 → 5")).toBeTruthy();
    expect(screen.queryByText(/Replaces Everyday/)).toBeNull();
  });

  it("disables apply when nothing is selected", async () => {
    setup({ changes: [changes[1]] });
    const apply = screen.getByRole("button", { name: "Add selected" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});
