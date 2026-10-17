// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLocationProvider } from "./AppLocationProvider";
import { useLocationProvider } from "./LocationProviderContext";

function Show() {
  const provider = useLocationProvider();
  return (
    <p>
      {provider.minQueryLength}|{provider.debounceMs}|{provider.attribution ? "credited" : ""}
    </p>
  );
}

describe("AppLocationProvider", () => {
  it("gives the app the API-backed provider: 2+ letters, 300 ms debounce, credited only when the server's provider is on", () => {
    const { unmount } = render(
      <AppLocationProvider providerOn>
        <Show />
      </AppLocationProvider>,
    );
    expect(screen.getByText("2|300|credited")).toBeTruthy();
    unmount();
    render(
      <AppLocationProvider>
        <Show />
      </AppLocationProvider>,
    );
    expect(screen.getByText("2|300|")).toBeTruthy();
  });

  it("without it, components get the curated provider (1 letter, no debounce, no credit)", () => {
    render(<Show />);
    expect(screen.getByText("1|0|")).toBeTruthy();
  });
});
