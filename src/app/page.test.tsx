import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TripsPage, { metadata as tripsMetadata } from "./page";
import SettingsPage, { metadata as settingsMetadata } from "./settings/page";
import StaplesPage, { metadata as staplesMetadata } from "./staples/page";
import { metadata as rootMetadata, viewport } from "./layout";

describe("screens", () => {
  it.each([
    ["Trips", TripsPage],
    ["Staples", StaplesPage],
    ["Settings", SettingsPage],
  ])("%s renders its heading", (name, Page) => {
    expect(renderToStaticMarkup(<Page />)).toContain(`<h1>${name}</h1>`);
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
