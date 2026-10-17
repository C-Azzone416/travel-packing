import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import TripsPage, { metadata as tripsMetadata } from "./page";
import SettingsPage, { metadata as settingsMetadata } from "./settings/page";
import StaplesPage, { metadata as staplesMetadata } from "./staples/page";
import { metadata as rootMetadata, viewport } from "./layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("screens", () => {
  it.each([
    ["Staples", StaplesPage],
    ["Settings", SettingsPage],
  ])("%s renders its heading", (name, Page) => {
    expect(renderToStaticMarkup(<Page />)).toContain(`<h1>${name}</h1>`);
  });

  it("Trips renders the dashboard, starting in its loading state", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <SaveStatusProvider>
          <TripsPage />
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
