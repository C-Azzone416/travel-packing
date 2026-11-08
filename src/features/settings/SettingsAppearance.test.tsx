// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
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
  initial: Appearance = "ocean",
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
          accountClosureEnabled
          closeAccount={async () => ({ error: null, fieldErrors: {} })}
        />
      </SaveStatusProvider>
    </ToastProvider>,
  );
  return updateAppearance;
}

beforeEach(() => {
  delete html.dataset.scheme;
  document.cookie = "appearance=; Max-Age=0; Path=/";
});
afterEach(() => {
  delete html.dataset.scheme;
  document.cookie = "appearance=; Max-Age=0; Path=/";
});

describe("Settings colour-scheme picker", () => {
  it("is a radiogroup named Colour scheme with three options named by their text, Ocean checked when nothing is saved", () => {
    setup();
    const group = screen.getByRole("radiogroup", { name: "Colour scheme" });
    expect(group).toBeTruthy();
    const names = within(group).getAllByRole("radio");
    expect(names.map((radio) => radio.getAttribute("value"))).toEqual([
      "ocean",
      "evergreen",
      "dusk",
    ]);
    expect(screen.getByText("Evergreen")).toBeTruthy();
    expect(screen.getByText("Dusk")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Ocean/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Current theme:/).textContent).toBe("Current theme: Ocean");
    // Each option draws its own scheme as a mini suitcase, scoped with data-scheme and hidden from assistive tech.
    const swatches = [...group.querySelectorAll(".appearance-swatches")];
    expect(swatches.map((swatch) => swatch.getAttribute("data-scheme"))).toEqual([
      "ocean",
      "evergreen",
      "dusk",
    ]);
    for (const swatch of swatches) {
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
      expect(swatch.querySelectorAll("i").length).toBe(2);
    }
  });

  it("applies the choice at once, saves it, mirrors the cookie and announces it", async () => {
    const updateAppearance = setup();
    await userEvent.click(screen.getByRole("radio", { name: /Evergreen/ }));
    expect(html.dataset.scheme).toBe("evergreen");
    expect(cookieValue()).toBe("evergreen");
    expect(updateAppearance).toHaveBeenCalledExactlyOnceWith("evergreen");
    const status = screen.getByText(/Current theme:/);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Current theme: Evergreen");
  });

  it("does not save again when the chosen theme is picked again", async () => {
    const updateAppearance = setup("dusk");
    await userEvent.click(screen.getByRole("radio", { name: /Dusk/ }));
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("reverts the screen, the attribute and the cookie when saving fails, and says so", async () => {
    setup("evergreen", async () => ({ ok: false, code: "INTERNAL" }));
    await userEvent.click(screen.getByRole("radio", { name: /Dusk/ }));
    expect(await screen.findByText("Couldn’t save that theme. Nothing was changed.")).toBeTruthy();
    expect(html.dataset.scheme).toBe("evergreen");
    expect(cookieValue()).toBe("evergreen");
    expect((screen.getByRole("radio", { name: /Evergreen/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("is operable from the keyboard", async () => {
    const updateAppearance = setup();
    await userEvent.tab();
    const ocean = screen.getByRole("radio", { name: /Ocean/ });
    ocean.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(updateAppearance).toHaveBeenCalledWith("evergreen"));
    expect(html.dataset.scheme).toBe("evergreen");
  });

  it("shows the account's theme on load when this device was showing another, without saving", async () => {
    html.dataset.scheme = "ocean";
    const updateAppearance = setup("dusk");
    await waitFor(() => expect(html.dataset.scheme).toBe("dusk"));
    expect(cookieValue()).toBe("dusk");
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("an account with no saved theme keeps Ocean and never writes one", async () => {
    const updateAppearance = setup("ocean");
    await waitFor(() => expect(html.dataset.scheme).toBe("ocean"));
    expect(updateAppearance).not.toHaveBeenCalled();
  });

  it("an old cookie on this device is replaced by the new id without saving (no database write)", async () => {
    document.cookie = "appearance=terracotta; Path=/";
    html.dataset.scheme = "evergreen";
    const updateAppearance = setup("evergreen");
    await waitFor(() => expect(cookieValue()).toBe("evergreen"));
    expect(updateAppearance).not.toHaveBeenCalled();
  });
});
