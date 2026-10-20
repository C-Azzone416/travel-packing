// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusProvider, useSaveStatus } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { lastSavedText, SettingsScreen } from "./SettingsScreen";

let tracker: ReturnType<typeof useSaveStatus>;
function Capture() {
  const value = useSaveStatus();
  useEffect(() => {
    tracker = value;
  });
  return null;
}

function setup(
  email: string | null = "owner@example.test",
  signOut = vi.fn(async () => {}),
  updateWeather?: (change: { weatherOptIn?: boolean; temperatureUnit?: "F" | "C" }) => Promise<
    | { ok: true; settings: { weatherOptIn: boolean; temperatureUnit: "F" | "C" } }
    | {
        ok: false;
        code: "INTERNAL";
        settings: { weatherOptIn: boolean; temperatureUnit: "F" | "C" };
      }
  >,
) {
  let saved = { weatherOptIn: false, temperatureUnit: "F" as "F" | "C" };
  const update =
    updateWeather ??
    vi.fn(async (change: { weatherOptIn?: boolean; temperatureUnit?: "F" | "C" }) => {
      saved = { ...saved, ...change };
      return { ok: true as const, settings: saved };
    });
  const view = render(
    <ToastProvider>
      <SaveStatusProvider>
        <Capture />
        <SettingsScreen
          email={email}
          signOut={signOut}
          initialWeather={{ weatherOptIn: false, temperatureUnit: "F" }}
          updateWeather={update}
        />
      </SaveStatusProvider>
    </ToastProvider>,
  );
  return { signOut, updateWeather: update, ...view };
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

  it("is honest before anything was saved (one line, no 'saved' claim, no Last saved), then after a real write", async () => {
    setup();
    expect(
      screen.getByText("No changes yet this visit. Changes you make are saved as you go."),
    ).toBeTruthy();
    expect(screen.queryByText("Everything you changed is saved.")).toBeNull();
    expect(screen.queryByText(/^Last saved/)).toBeNull();
    await act(async () => {
      await tracker.track(async () => "ok");
    });
    expect(screen.getByText("Everything you changed is saved.")).toBeTruthy();
    expect(screen.getByText(/^Last saved /).textContent).toMatch(
      /^Last saved \d{1,2}:\d{2}\s?[AP]M$/,
    );
  });

  it("says Saving… while a write is in flight, never that everything is saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setup();
      let finish!: () => void;
      const pending = new Promise<string>((resolve) => (finish = () => resolve("ok")));
      let write!: Promise<string>;
      act(() => {
        write = tracker.track(() => pending);
      });
      // "Saving…" shows only if a write takes longer than the short delay (no flicker for quick saves).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Saving…")).toBeTruthy();
      expect(screen.queryByText("Everything you changed is saved.")).toBeNull();
      expect(screen.queryByText(/^No changes yet/)).toBeNull();
      await act(async () => {
        finish();
        await write;
      });
      expect(screen.getByText("Everything you changed is saved.")).toBeTruthy();
      expect(screen.queryByText("Saving…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim 'saved' while the last change failed, and offers Retry right in the card", async () => {
    setup();
    const write = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("ok");
    await act(async () => {
      await tracker.track(write).catch(() => {});
    });
    expect(screen.getByText(/Your last change hasn’t been saved/)).toBeTruthy();
    expect(screen.queryByText("Everything you changed is saved.")).toBeNull();
    expect(screen.queryByText(/^Last saved/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Everything you changed is saved.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("has no Offline, Waiting, simulated-sync or sample-data copy, and no Data section yet", () => {
    const { container } = setup();
    expect(container.textContent).not.toMatch(/offline|waiting|simulat|sample|reset/i);
    expect(screen.queryByRole("heading", { name: "Data" })).toBeNull();
  });

  it("saves weather opt-in and units, and keeps units unavailable while weather is off", async () => {
    const { updateWeather } = setup();
    const weather = screen.getByRole("switch", { name: "Weather for my trips" });
    const celsius = screen.getByRole("radio", { name: "°C" });
    expect((celsius as HTMLInputElement).disabled).toBe(true);

    await userEvent.click(weather);
    expect(updateWeather).toHaveBeenCalledWith({ weatherOptIn: true });
    expect((celsius as HTMLInputElement).disabled).toBe(false);
    await userEvent.click(celsius);
    expect(updateWeather).toHaveBeenCalledWith({ temperatureUnit: "C" });

    await userEvent.click(weather);
    expect(await screen.findByText("Weather is off. Your lists are unchanged.")).toBeTruthy();
    expect((celsius as HTMLInputElement).disabled).toBe(true);
  });

  it("rolls back a weather setting and reports a failed write", async () => {
    const failed = vi.fn(async () => ({
      ok: false as const,
      code: "INTERNAL" as const,
      settings: { weatherOptIn: false, temperatureUnit: "F" as const },
    }));
    setup(
      "owner@example.test",
      vi.fn(async () => {}),
      failed,
    );
    const weather = screen.getByRole("switch", { name: "Weather for my trips" });
    await userEvent.click(weather);
    expect(
      await screen.findByText("Couldn’t save that setting. Nothing was changed."),
    ).toBeTruthy();
    expect((weather as HTMLInputElement).checked).toBe(false);
  });
});

describe("lastSavedText", () => {
  it("formats the time of the last write", () => {
    expect(lastSavedText(new Date(2026, 9, 16, 15, 42))).toMatch(/^Last saved 3:42\s?PM$/);
  });
});
