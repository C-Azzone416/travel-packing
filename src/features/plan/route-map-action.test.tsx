import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  requireOwner: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/server/data/runtime", () => ({ getDataContext: fakes.getDataContext }));
vi.mock("@/server/auth/guard", () => ({
  AuthFailure: class AuthFailure extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  requireOwner: fakes.requireOwner,
}));
vi.mock("next/navigation", () => ({ redirect: fakes.redirect }));

import { RouteMap } from "@/components/route-map/RouteMap";
import { renderRouteMapAction } from "./route-map-action";

const POINTS = [
  { lat: 47.61, lng: -122.33, label: "Seattle", kind: "home" as const },
  { lat: 38.72, lng: -9.14, label: "Lisbon", kind: "stop" as const },
];

describe("renderRouteMapAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getDataContext.mockResolvedValue({ auth: { provider: {}, allowlist: {} } });
    fakes.requireOwner.mockResolvedValue({ userId: "owner" });
  });

  it("draws the route for the owner at the laptop tag's size", async () => {
    const element = await renderRouteMapAction({ points: POINTS, mode: "fly", size: "laptop" });
    expect(element?.type).toBe(RouteMap);
    expect(element?.props).toMatchObject({
      points: POINTS,
      mode: "fly",
      width: 418,
      height: 160,
      radius: 12,
      oceanLabel: true,
    });
  });

  it("draws the phone size without the ocean's name", async () => {
    const element = await renderRouteMapAction({ points: POINTS, mode: "drive", size: "phone" });
    expect(element?.props).toMatchObject({
      width: 346,
      height: 133,
      oceanLabel: false,
      mode: "drive",
    });
  });

  it.each([
    ["too many points", { points: Array(9).fill(POINTS[0]), mode: "fly", size: "laptop" }],
    [
      "a latitude off the globe",
      { points: [{ ...POINTS[0], lat: 91 }], mode: "fly", size: "laptop" },
    ],
    [
      "a longitude off the globe",
      { points: [{ ...POINTS[0], lng: 181 }], mode: "fly", size: "laptop" },
    ],
    [
      "a label that is not text",
      { points: [{ ...POINTS[0], label: 5 }], mode: "fly", size: "laptop" },
    ],
    ["an unknown mode", { points: POINTS, mode: "swim", size: "laptop" }],
    ["an unknown size", { points: POINTS, mode: "fly", size: "huge" }],
    ["nothing at all", undefined],
  ])("draws nothing for %s, and never asks who is calling", async (_name, input) => {
    expect(await renderRouteMapAction(input as never)).toBeNull();
    expect(fakes.getDataContext).not.toHaveBeenCalled();
  });

  it("draws nothing without a data context", async () => {
    fakes.getDataContext.mockResolvedValue(null);
    expect(await renderRouteMapAction({ points: POINTS, mode: "fly", size: "laptop" })).toBeNull();
  });

  it("sends a signed-out visitor to sign in and a visitor off the allowlist to access denied", async () => {
    const { AuthFailure } = await import("@/server/auth/guard");
    fakes.requireOwner.mockRejectedValueOnce(new AuthFailure("UNAUTHENTICATED" as never));
    await expect(
      renderRouteMapAction({ points: POINTS, mode: "fly", size: "laptop" }),
    ).rejects.toThrow(/NEXT_REDIRECT:\/sign-in/);
    fakes.requireOwner.mockRejectedValueOnce(new AuthFailure("FORBIDDEN" as never));
    await expect(
      renderRouteMapAction({ points: POINTS, mode: "fly", size: "laptop" }),
    ).rejects.toThrow(/NEXT_REDIRECT:\/access-denied/);
  });

  it("draws nothing for any other failure", async () => {
    fakes.requireOwner.mockRejectedValueOnce(new Error("boom"));
    expect(await renderRouteMapAction({ points: POINTS, mode: "fly", size: "laptop" })).toBeNull();
  });
});
