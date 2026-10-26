// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusProvider, useSaveStatus } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { lastSavedText, SettingsScreen } from "./SettingsScreen";
import type { CloseAccountState } from "./close-account-state";

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
  closeAccount = vi.fn(
    async (previous: CloseAccountState, formData: FormData): Promise<CloseAccountState> => {
      void previous;
      void formData;
      return { error: null, fieldErrors: {} };
    },
  ),
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
          initialAppearance="base"
          updateAppearance={async (appearance) => ({ ok: true as const, appearance })}
          closeAccount={closeAccount}
        />
      </SaveStatusProvider>
    </ToastProvider>,
  );
  return { signOut, updateWeather: update, closeAccount, ...view };
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

  it("requires the password and exact irreversible confirmation in a nondismissable account sheet", async () => {
    const { closeAccount } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    expect(screen.getByRole("dialog", { name: "Close your account?" })).toBeTruthy();
    expect(screen.getByLabelText("Current password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Current password"));

    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog", { name: "Close your account?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closeAccount).not.toHaveBeenCalled();
  });

  it("submits only the explicit password and DELETE confirmation", async () => {
    const { closeAccount } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    await userEvent.type(screen.getByLabelText("Current password"), "synthetic-password");
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Close account permanently" }));
    expect(closeAccount).toHaveBeenCalledTimes(1);
    const submitted = closeAccount.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(submitted)).toEqual({
      password: "synthetic-password",
      confirmation: "DELETE",
    });
  });

  it("hides a stale failure while a retry is pending", async () => {
    let resolveRetry!: (state: CloseAccountState) => void;
    const retry = new Promise<CloseAccountState>((resolve) => {
      resolveRetry = resolve;
    });
    const closeAccount = vi
      .fn<(previous: CloseAccountState, formData: FormData) => Promise<CloseAccountState>>()
      .mockResolvedValueOnce({
        error:
          "Your Packed Smart data is removed and access is blocked, but account closure wasn’t confirmed. Try again to finish.",
        fieldErrors: {},
        recovery: true,
      })
      .mockReturnValueOnce(retry);
    setup(undefined, undefined, undefined, closeAccount);
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    const submit = screen.getByRole("button", { name: "Close account permanently" });
    await userEvent.click(submit);
    expect(await screen.findByText(/data is removed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Finish account closure" }).className).toBe(
      "auth-link inline-link",
    );

    await userEvent.click(submit);
    expect(screen.getByRole("button", { name: "Closing…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/data is removed/)).toBeNull();

    await act(async () => resolveRetry({ error: null, fieldErrors: {} }));
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
