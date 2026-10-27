import { describe, expect, it } from "vitest";
import { captureBlocked, reportContext, sceneCode, viewportClass } from "./capture-policy";

describe("captureBlocked", () => {
  it.each([
    "/sign-in",
    "/sign-up",
    "/verify",
    "/forgot-password",
    "/reset-password",
    "/finish-setup",
    "/access-denied",
    "/sign-in/callback",
    // Account closure asks for the current password and the word DELETE; it stays blocked while Settings opens up (#273).
    "/close-account",
    "/close-account/",
    "/close-account/complete",
    "/close-account/complete/extra",
  ])("blocks %s", (path) => {
    expect(captureBlocked(path)).toBe(true);
  });

  it.each([
    "/",
    "/trips/new",
    "/trips/abc",
    "/trips/abc/review",
    "/staples",
    // Settings is captured with its sensitive parts left out before the picture is made (#273).
    "/settings",
    "/settings/",
    "/settings/account",
    "/settingsx",
    "/signin",
    // Only the route and what is under it: a different word that merely starts the same is a different screen, as with /settingsx.
    "/close-accounts",
    "/close-account-x",
  ])("allows %s", (path) => {
    expect(captureBlocked(path)).toBe(false);
  });
});

describe("sceneCode (a code for the screen, never the path)", () => {
  it.each([
    ["/", "trips"],
    ["/trips/new", "new-trip"],
    ["/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11", "trip"],
    ["/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11/review", "review"],
    ["/staples", "staples"],
    ["/something-else", "other"],
    ["/trips", "other"],
    ["/trips/a/b/c", "other"],
  ])("%s is %s", (path, code) => {
    expect(sceneCode(path)).toBe(code);
  });

  it("never echoes a trip id", () => {
    expect(sceneCode("/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11")).not.toMatch(/6c1f/);
  });
});

describe("viewportClass", () => {
  it.each([
    [320, "phone"],
    [659, "phone"],
    [660, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1920, "desktop"],
  ])("%ipx is %s", (width, expected) => {
    expect(viewportClass(width)).toBe(expected);
  });
});

describe("reportContext", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");

  it("holds approved codes and numbers only", () => {
    expect(
      reportContext({
        pathname: "/trips/6c1f7d2e-9b1a-4c55-8a2e-0d3f2c9a7b11",
        viewportWidth: 390,
        coarsePointer: true,
        buildSha: "0123456789abcdef0123456789abcdef01234567",
        now,
      }),
    ).toEqual({
      gameId: "travel-packing",
      buildSha: "0123456789abcdef0123456789abcdef01234567",
      scene: "trip",
      platform: "phone",
      input: "touch",
      capturedAt: "2026-10-21T12:00:00.000Z",
      breadcrumbs: [],
      appVersion: "0123456",
    });
  });

  it("falls back to a mouse, a null build and the dev version", () => {
    const context = reportContext({
      pathname: "/",
      viewportWidth: 1440,
      coarsePointer: false,
      buildSha: null,
      now,
    });
    expect(context).toMatchObject({
      input: "mouse",
      buildSha: null,
      appVersion: "dev",
      platform: "desktop",
    });
  });
});
