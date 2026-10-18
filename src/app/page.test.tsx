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
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: { getSession: async () => ({ userId: "u", email: "owner@example.test" }) },
  }),
}));
vi.mock("@/app/sign-in/actions", () => ({ signOutAction: async () => {} }));

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
      <SaveStatusProvider>{await SettingsPage()}</SaveStatusProvider>,
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
    expect(viewport.themeColor).toBe("#166D7A");
  });
});
