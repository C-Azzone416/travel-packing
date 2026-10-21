import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import TripsPage, { metadata as tripsMetadata } from "./page";
import SettingsPage, { metadata as settingsMetadata } from "./settings/page";
import StaplesPage, { metadata as staplesMetadata } from "./staples/page";
import { metadata as rootMetadata, viewport } from "./layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("./fonts", () => ({ fontClassNames: "" }));
vi.mock("@/features/settings/saved-appearance", () => ({
  readSavedAppearance: async () => "base",
  appearanceForRequest: async () => "base",
}));
vi.mock("@/features/settings/appearance-actions", () => ({
  updateAppearanceAction: async (appearance: string) => ({ ok: true, appearance }),
}));
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: { getSession: async () => ({ userId: "u", email: "owner@example.test" }) },
  }),
}));
vi.mock("@/app/sign-in/actions", () => ({ signOutAction: async () => {} }));
vi.mock("@/features/settings/weather-actions", () => ({
  getWeatherSettingsAction: async () => ({
    ok: true,
    settings: { weatherOptIn: false, temperatureUnit: "F" },
  }),
  updateWeatherSettingsAction: async () => ({
    ok: true,
    settings: { weatherOptIn: false, temperatureUnit: "F" },
  }),
}));

describe("screens", () => {
  it("Staples renders its screen, starting in its loading state", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <SaveStatusProvider>
          <TripsSourceProvider>
            <StaplesPage />
          </TripsSourceProvider>
        </SaveStatusProvider>
      </ToastProvider>,
    );
    expect(html).toContain("<h1>Every trip starts here</h1>");
    expect(html).toContain('aria-label="Loading staples"');
  });

  it("Settings renders the signed-in account and a Sign out button", async () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <SaveStatusProvider>{await SettingsPage()}</SaveStatusProvider>
      </ToastProvider>,
    );
    expect(html).toContain("<h1>Settings</h1>");
    expect(html).toContain("owner@example.test");
    expect(html).toContain("Sign out");
  });

  it("Trips renders the dashboard, starting in its loading state", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <SaveStatusProvider>
          <TripsSourceProvider>
            <TripsPage />
          </TripsSourceProvider>
        </SaveStatusProvider>
      </ToastProvider>,
    );
    expect(html).toContain("<h1>Trips</h1>");
    expect(html).toContain('aria-label="Loading trips"');
  });

  it("titles each screen '<Screen> · Carrywell'", () => {
    expect(tripsMetadata.title).toEqual({ absolute: "Trips · Carrywell" });
    expect(staplesMetadata.title).toBe("Staples");
    expect(settingsMetadata.title).toBe("Settings");
  });
});

describe("root layout metadata", () => {
  it("titles screens '<Screen> · Carrywell'", () => {
    expect(rootMetadata.title).toEqual({ default: "Carrywell", template: "%s · Carrywell" });
  });

  it("sets the brand theme color", () => {
    expect(viewport.themeColor).toBe("#e9e3d6");
  });
});
