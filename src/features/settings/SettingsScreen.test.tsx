// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusProvider, useSaveStatus } from "@/components/shell/SaveStatus";
import { lastSavedText, SettingsScreen } from "./SettingsScreen";

let tracker: ReturnType<typeof useSaveStatus>;
function Capture() {
  tracker = useSaveStatus();
  return null;
}

function setup(email: string | null = "owner@example.test", signOut = vi.fn(async () => {})) {
  const view = render(
    <SaveStatusProvider>
      <Capture />
      <SettingsScreen email={email} signOut={signOut} />
    </SaveStatusProvider>,
  );
  return { signOut, ...view };
}

describe("SettingsScreen", () => {
  it("shows the account and a Sign out button that goes straight through (no confirm)", async () => {
    const { signOut } = setup();
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account", level: 2 })).toBeTruthy();
    expect(screen.getByText("owner@example.test")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("leaves the email out when there is none, and still offers Sign out", () => {
    setup(null);
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("says nothing has been saved yet, then when the last write succeeded", async () => {
    setup();
    expect(screen.getByText("Nothing saved yet this visit.")).toBeTruthy();
    expect(screen.getByText("Everything you changed is saved.")).toBeTruthy();
    await act(async () => {
      await tracker.track(async () => "ok");
    });
    expect(screen.getByText(/^Last saved /).textContent).toMatch(
      /^Last saved \d{1,2}:\d{2}\s?[AP]M$/,
    );
  });

  it("does not claim 'saved' while the last change failed", async () => {
    setup();
    await act(async () => {
      await tracker.track(() => Promise.reject(new Error("down"))).catch(() => {});
    });
    expect(screen.getByText(/Your last change hasn’t been saved/)).toBeTruthy();
    expect(screen.queryByText("Everything you changed is saved.")).toBeNull();
    expect(screen.getByText("Nothing saved yet this visit.")).toBeTruthy();
  });

  it("has no Offline, Waiting, simulated-sync or sample-data copy, and no Data section yet", () => {
    const { container } = setup();
    expect(container.textContent).not.toMatch(/offline|waiting|simulat|sample|reset/i);
    expect(screen.queryByRole("heading", { name: "Data" })).toBeNull();
  });
});

describe("lastSavedText", () => {
  it("formats a time, or says nothing was saved", () => {
    expect(lastSavedText(null)).toBe("Nothing saved yet this visit.");
    expect(lastSavedText(new Date(2026, 9, 16, 15, 42))).toMatch(/^Last saved 3:42\s?PM$/);
  });
});
