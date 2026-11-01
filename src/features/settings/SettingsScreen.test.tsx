// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SAVED_CONFIRMATION_MS,
  SaveStatusProvider,
  useSaveStatus,
} from "@/components/shell/SaveStatus";
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

// The Save status card (the global sr-only region also says "Saved", so card checks are scoped to it).
function saveCard() {
  const heading = screen.getByRole("heading", { name: "Save status" });
  const card = heading.closest("section");
  if (!card) throw new Error("the Save status card is missing");
  return within(card);
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
  accountClosureEnabled = true,
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
          accountClosureEnabled={accountClosureEnabled}
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

  it("hides the destructive entry point while the server rollout gate is off", () => {
    setup(undefined, undefined, undefined, undefined, false);
    expect(screen.queryByRole("button", { name: "Close account" })).toBeNull();
    expect(screen.queryByText("Permanently remove your account identity")).toBeNull();
  });

  it("requires the password and exact irreversible confirmation in a nondismissable account sheet", async () => {
    const { closeAccount } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    expect(screen.getByRole("dialog", { name: "Close your account?" })).toBeTruthy();
    expect(
      screen.getByText(
        /asks the identity provider to remove the account and sessions in the same request/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Packed Smart can’t confirm or erase them/)).toBeTruthy();
    expect(screen.getByText(/It can’t be undone/)).toBeTruthy();
    expect(screen.getByLabelText("Current password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(screen.getByLabelText("Type DELETE to confirm").getAttribute("autocomplete")).toBe(
      "one-time-code",
    );
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

  it("is honest before anything was saved: Up to date with no Last saved line, then Saved after a real write", async () => {
    setup();
    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.queryByText(/^Last saved/)).toBeNull();
    expect(saveCard().queryByText("Saved")).toBeNull();
    await act(async () => {
      await tracker.track(async () => "ok");
    });
    expect(saveCard().getByText("Saved")).toBeTruthy();
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.queryByText(/^Last saved/)).toBeNull();
  });

  it("says Saving… from the first moment of a write, before the chip's short delay, never Up to date", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setup();
      let finish!: () => void;
      const inFlight = new Promise<string>((resolve) => (finish = () => resolve("ok")));
      let write!: Promise<string>;
      act(() => {
        write = tracker.track(() => inFlight);
      });
      expect(tracker.status).toBe("idle");
      expect(tracker.pending).toBe(true);
      expect(screen.getByText("Saving…")).toBeTruthy();
      expect(screen.queryByText("Up to date")).toBeNull();
      await act(async () => {
        finish();
        await write;
      });
      expect(saveCard().getByText("Saved")).toBeTruthy();
      expect(screen.queryByText("Saving…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Saving… for a slow write, then Saved, then Up to date with Last saved once the confirmation passes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setup();
      let finish!: () => void;
      const inFlight = new Promise<string>((resolve) => (finish = () => resolve("ok")));
      let write!: Promise<string>;
      act(() => {
        write = tracker.track(() => inFlight);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Saving…")).toBeTruthy();
      expect(screen.queryByText("Up to date")).toBeNull();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("Saving");
      await act(async () => {
        finish();
        await write;
      });
      expect(saveCard().getByText("Saved")).toBeTruthy();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("Saved");
      expect(screen.queryByText(/^Last saved/)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SAVED_CONFIRMATION_MS);
      });
      expect(screen.getByText("Up to date")).toBeTruthy();
      expect(saveCard().queryByText("Saved")).toBeNull();
      expect(screen.getByText(/^Last saved \d{1,2}:\d{2}\s?[AP]M$/)).toBeTruthy();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Not saved, the detail line and Retry after a failed change, never Up to date", async () => {
    setup();
    const write = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("ok");
    await act(async () => {
      await tracker.track(write).catch(() => {});
    });
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.getByText("Your change is still on screen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.queryByText(/^Last saved/)).toBeNull();
    expect(saveCard().queryByText("Saved")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(saveCard().getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText("Not saved")).toBeNull();
  });

  it("keeps the failed copy and Retry while a retry is still in flight, and never says Up to date", async () => {
    let finishRetry!: () => void;
    const write = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          finishRetry = () => resolve("ok");
        }),
      );
    setup();
    await act(async () => {
      await tracker.track(write).catch(() => {});
    });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.getByText("Your change is still on screen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.queryByText("Saving…")).toBeNull();
    await act(async () => {
      finishRetry();
    });
    expect(saveCard().getByText("Saved")).toBeTruthy();
    expect(screen.queryByText("Not saved")).toBeNull();
  });

  it("returns from a failure to Saved, then Up to date with Last saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setup();
      const write = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue("ok");
      await act(async () => {
        await tracker.track(write).catch(() => {});
      });
      expect(screen.getByText("Not saved")).toBeTruthy();
      await act(async () => {
        screen.getByRole("button", { name: "Retry" }).click();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(saveCard().getByText("Saved")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SAVED_CONFIRMATION_MS);
      });
      expect(screen.getByText("Up to date")).toBeTruthy();
      expect(screen.getByText(/^Last saved /)).toBeTruthy();
      expect(screen.queryByText("Not saved")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts no live region or role=status on the card, and marks the glyph decorative", async () => {
    setup();
    await act(async () => {
      await tracker.track(async () => "ok");
    });
    const card = screen.getByRole("heading", { name: "Save status" }).closest("section");
    if (!card) throw new Error("the Save status card is missing");
    expect(card.querySelectorAll('[role="status"], [role="alert"], [aria-live]').length).toBe(0);
    expect(card.querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
    expect(saveCard().getByText("Saved")).toBeTruthy();
  });

  it("shows none of the old save-status copy", () => {
    setup();
    expect(screen.queryByText(/No changes yet|Everything you changed/)).toBeNull();
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
