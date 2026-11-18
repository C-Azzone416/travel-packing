// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeNewTripLink } from "./HomeNewTripLink";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  pathname = "/";
});

describe("HomeNewTripLink", () => {
  it("is a direct, labelled create action on Home", () => {
    render(<HomeNewTripLink />);
    const link = screen.getByRole("link", { name: "New trip" });
    expect(link.getAttribute("href")).toBe("/trips/new");
    expect(link.textContent).toContain("New trip");
  });

  it("does not change other screen headers", () => {
    pathname = "/settings";
    render(<HomeNewTripLink />);
    expect(screen.queryByRole("link", { name: "New trip" })).toBeNull();
  });
});
