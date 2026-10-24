// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaplesSetupResult } from "@/features/trips/trip-actions";
import { STAPLE_SUGGESTIONS } from "@/domain/staples-setup";
import { StaplesSetupGate, type StaplesSetupActions } from "./StaplesSetupGate";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = "/";
});

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
  it("fails open outside Staples and retries the setup read", async () => {
    const user = userEvent.setup();
    const api = actions(answer("completed"));
    api.get = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer("completed"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Couldn’t check your Staples setup.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("keeps the load error blocking on the Staples screen until retry succeeds", async () => {
    pathname = "/staples";
    const user = userEvent.setup();
    const api = actions(answer("completed"));
    api.get = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer("completed"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Staples page</div>
      </StaplesSetupGate>,
    );

    expect(await screen.findByText("Couldn’t load your Staples setup.")).toBeTruthy();
    expect(screen.queryByText("Staples page")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Staples page")).toBeTruthy();
  });

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

  it("ignores a second save click while the first submission is pending", async () => {
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
    await user.click(save);
    await user.click(save);
    expect(api.save).toHaveBeenCalledTimes(1);
    finish(answer("completed"));
    expect(await screen.findByText("Trips dashboard")).toBeTruthy();
  });

  it("keeps selections when save returns an error result and retries without a load failure", async () => {
    const user = userEvent.setup();
    const api = actions(answer("incomplete"));
    api.save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
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

  it("keeps setup open when Skip fails", async () => {
    const user = userEvent.setup();
    const api = actions(answer("incomplete"));
    api.skip = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    await user.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("heading", { name: "Build your Staples" })).toBeTruthy();
    expect(screen.queryByText("Trips dashboard")).toBeNull();
  });

  it("keeps the reminder visible when dismissal fails", async () => {
    const user = userEvent.setup();
    const api = actions(answer("skipped"));
    api.dismiss = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    await user.click(await screen.findByRole("button", { name: "Don’t remind me" }));
    expect(screen.getByRole("complementary", { name: "Staples setup reminder" })).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t update your reminder.",
    );
  });

  it("sends one dismissal while the first request is pending", async () => {
    const user = userEvent.setup();
    let finish!: (value: StaplesSetupResult) => void;
    const pending = new Promise<StaplesSetupResult>((resolve) => {
      finish = resolve;
    });
    const api = actions(answer("skipped"));
    api.dismiss = vi.fn(() => pending);
    render(
      <StaplesSetupGate actions={api}>
        <div>Trips dashboard</div>
      </StaplesSetupGate>,
    );

    const dismiss = await screen.findByRole("button", { name: "Don’t remind me" });
    await user.dblClick(dismiss);
    expect(api.dismiss).toHaveBeenCalledTimes(1);
    expect((dismiss as HTMLButtonElement).disabled).toBe(true);
    finish(answer("skipped", true));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
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
