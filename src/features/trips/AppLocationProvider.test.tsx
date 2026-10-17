// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLocationProvider } from "./AppLocationProvider";
import { useLocationProvider } from "./LocationProviderContext";

function Show() {
  const provider = useLocationProvider();
  return (
    <p>
      {provider.minQueryLength}|{provider.debounceMs}|{provider.attribution}
    </p>
  );
}

describe("AppLocationProvider", () => {
  it("gives the app the API-backed provider: 2+ letters, 300 ms debounce, credited", () => {
    render(
      <AppLocationProvider>
        <Show />
      </AppLocationProvider>,
    );
    expect(screen.getByText("2|300|Place search is provided by Open-Meteo.")).toBeTruthy();
  });

  it("without it, components get the curated provider (1 letter, no debounce, no credit)", () => {
    render(<Show />);
    expect(screen.getByText("1|0|")).toBeTruthy();
  });
});
