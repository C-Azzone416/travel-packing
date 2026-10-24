// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StaplesSetupResult } from "@/features/trips/trip-actions";
import { STAPLE_SUGGESTIONS } from "@/domain/staples-setup";
import { StaplesSetupGate, type StaplesSetupActions } from "./StaplesSetupGate";

const answer = (
  state: "incomplete" | "skipped" | "completed",
  reminderDismissed = false,
): StaplesSetupResult => ({
  ok: true,
  state,
  reminderDismissed,
  staples: [],
});

function actions(initial: StaplesSetupResult): StaplesSetupActions {
  return {
    get: vi.fn(async () => initial),
    save: vi.fn(async () => answer("completed")),
    skip: vi.fn(async () => answer("skipped")),
    dismiss: vi.fn(async () => answer("skipped", true)),
  };
}

describe("StaplesSetupGate", () => {
  it("shows first-run setup, persists skip, then shows a dismissible reminder", async () => {
    const user = userEvent.setup();
    const api = actions(answer("incomplete"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );
    expect(await screen.findByRole("heading", { name: "Build your Staples" })).toBeTruthy();
    expect(screen.queryByText("Trips dashboard")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Staples setup reminder" })).toBeTruthy();
    expect(api.skip).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Don’t remind me" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(api.dismiss).toHaveBeenCalledTimes(1);
  });

  it("lets a skipped owner reopen setup without changing state when they choose not now", async () => {
    const user = userEvent.setup();
    const api = actions(answer("skipped"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );
    await user.click(await screen.findByRole("button", { name: "Build Staples" }));
    expect(screen.getByRole("heading", { name: "Build your Staples" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
    expect(api.skip).not.toHaveBeenCalled();
  });

  it("sends one save while the first submission is pending", async () => {
    const user = userEvent.setup();
    let finish!: (value: StaplesSetupResult) => void;
    const pending = new Promise<StaplesSetupResult>((resolve) => {
      finish = resolve;
    });
    const api = actions(answer("incomplete"));
    api.save = vi.fn(() => pending);
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );
    const save = await screen.findByRole("button", { name: "Save empty Staples" });
    await user.dblClick(save);
    expect(api.save).toHaveBeenCalledTimes(1);
    finish(answer("completed"));
    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
  });

  it("keeps selections after a failed save and retries without showing the load failure", async () => {
    const user = userEvent.setup();
    const api = actions(answer("incomplete"));
    api.save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer("completed"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    const underwear = await screen.findByRole("checkbox", { name: "Underwear" });
    await user.click(underwear);
    await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t save your Staples.Your selections are still here.",
    );
    expect((underwear as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Couldn’t load your Staples setup.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try save again" }));
    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
    expect(api.save).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          id: STAPLE_SUGGESTIONS.find(({ staple }) => staple.name === "Underwear")?.staple.id,
        }),
      ]),
    );
  });

  it("labels migrated owners' reminder as a review invitation", async () => {
    const existing = answer("skipped") as Extract<StaplesSetupResult, { ok: true }>;
    existing.staples = [STAPLE_SUGGESTIONS[0].staple];
    const api = actions(existing);
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    expect(await screen.findByText("Review the Staples already in your account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review Staples" })).toBeTruthy();
  });
});
