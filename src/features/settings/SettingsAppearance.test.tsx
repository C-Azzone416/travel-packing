// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import type { Appearance } from "@/domain/appearance";
import type { AppearanceResult } from "./appearance-actions";
import { SettingsScreen } from "./SettingsScreen";

const html = document.documentElement;
const cookieValue = () => /(?:^|; )appearance=([^;]*)/.exec(document.cookie)?.[1];

function setup(
  initial: Appearance = "base",
  update: (a: Appearance) => Promise<AppearanceResult> = async (appearance) => ({
    ok: true,
    appearance,
  }),
) {
  const updateAppearance = vi.fn(update);
  render(
    <ToastProvider>
      <SaveStatusProvider>
        <SettingsScreen
          email="owner@example.test"
          signOut={async () => {}}
          initialWeather={{ weatherOptIn: false, temperatureUnit: "F" }}
          updateWeather={async () => ({
            ok: true,
            settings: { weatherOptIn: false, temperatureUnit: "F" },
          })}
          initialAppearance={initial}
          updateAppearance={updateAppearance}
        />
      </SaveStatusProvider>
    </ToastProvider>,
  );
  return updateAppearance;
}

beforeEach(() => {
  delete html.dataset.appearance;
  document.cookie = "appearance=; Max-Age=0; Path=/";
});
afterEach(() => {
  delete html.dataset.appearance;
  document.cookie = "appearance=; Max-Age=0; Path=/";
});

describe("Settings Theme picker", () => {
  it("is a radiogroup named Theme with four options named by their text, Base checked when nothing is saved", () => {
    setup();
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeTruthy();
    const names = screen.getAllByRole("radio", { name: /palette|Ocean|Terracotta|Violet/ });
    expect(names.map((radio) => radio.getAttribute("value"))).toEqual([
      "base",
      "ocean",
      "terracotta",
      "violet",
    ]);
    expect((screen.getByRole("radio", { name: /Base palette/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText(/Current theme:/).textContent).toBe("Current theme: Base palette");
    expect(group.querySelectorAll("[aria-hidden=true]").length).toBeGreaterThan(0);
  });

  it("applies the choice at once, saves it, mirrors the cookie and announces it", async () => {
    const updateAppearance = setup();
    await userEvent.click(screen.getByRole("radio", { name: /Deep Ocean/ }));
    expect(html.dataset.appearance).toBe("ocean");
    expect(cookieValue()).toBe("ocean");
    expect(updateAppearance).toHaveBeenCalledExactlyOnceWith("ocean");
    const status = screen.getByText(/Current theme:/);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Current theme: Deep Ocean");
  });

  it("does not save again when the chosen theme is picked again", async () => {
    const updateAppearance = setup("ocean");
    await userEvent.click(screen.getByRole("radio", { name: /Deep Ocean/ }));
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("reverts the screen, the attribute and the cookie when saving fails, and says so", async () => {
    setup("terracotta", async () => ({ ok: false, code: "INTERNAL" }));
    await userEvent.click(screen.getByRole("radio", { name: /Ink Violet/ }));
    expect(await screen.findByText("Couldn’t save that theme. Nothing was changed.")).toBeTruthy();
    expect(html.dataset.appearance).toBe("terracotta");
    expect(cookieValue()).toBe("terracotta");
    expect((screen.getByRole("radio", { name: /Terracotta/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("is operable from the keyboard", async () => {
    const updateAppearance = setup();
    await userEvent.tab();
    const base = screen.getByRole("radio", { name: /Base palette/ });
    base.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(updateAppearance).toHaveBeenCalledWith("ocean"));
    expect(html.dataset.appearance).toBe("ocean");
  });

  it("shows the account's theme on load when this device was showing another, without saving", async () => {
    html.dataset.appearance = "base";
    const updateAppearance = setup("violet");
    await waitFor(() => expect(html.dataset.appearance).toBe("violet"));
    expect(cookieValue()).toBe("violet");
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("an account with no saved theme keeps Base and never writes one", async () => {
    const updateAppearance = setup("base");
    await waitFor(() => expect(html.dataset.appearance).toBe("base"));
    expect(updateAppearance).not.toHaveBeenCalled();
  });
});
