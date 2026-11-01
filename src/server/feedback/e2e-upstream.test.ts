import { describe, expect, it, vi } from "vitest";
import {
  e2eRouteLimits as stubbedLimits,
  e2eUpstreamFetch as stubbed,
} from "./e2e-upstream.disabled";
import { E2E_UPSTREAM_MARKER, e2eRouteLimits, e2eUpstreamFetch } from "./e2e-upstream";
import { FRAMEBRIAR_ENDPOINT } from "./framebriar-client";

describe("the e2e upstream seam", () => {
  const enabled = { NEXT_PUBLIC_E2E_BUILD: "1", E2E_FRAMEBRIAR_PORT: "3400" };

  it("does nothing without a port, or with one that is not a port", () => {
    expect(e2eUpstreamFetch({})).toBeNull();
    for (const bad of ["", "abc", "12", "123", "123456", "70000", "80;rm", "-1", "1e3"]) {
      expect(e2eUpstreamFetch({ ...enabled, E2E_FRAMEBRIAR_PORT: bad })).toBeNull();
    }
  });

  it("needs exact e2e build opt-in and is always off on Vercel", () => {
    expect(e2eUpstreamFetch({ E2E_FRAMEBRIAR_PORT: "3400" })).toBeNull();
    expect(e2eUpstreamFetch({ ...enabled, NEXT_PUBLIC_E2E_BUILD: "true" })).toBeNull();
    expect(e2eUpstreamFetch({ ...enabled, VERCEL: "1" })).toBeNull();
  });

  it("sends the pinned Framebriar address, and only that, to the local fake", async () => {
    const seen = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", seen);
    try {
      const send = e2eUpstreamFetch(enabled)!;
      await send(`${FRAMEBRIAR_ENDPOINT}/v1/access/redeem`, { method: "POST", body: "x" });
      expect(seen).toHaveBeenCalledWith("http://127.0.0.1:3400/api/v1/access/redeem", {
        method: "POST",
        body: "x",
      });
      await send(new URL(`${FRAMEBRIAR_ENDPOINT}/v1/reports`));
      expect(seen).toHaveBeenLastCalledWith("http://127.0.0.1:3400/api/v1/reports", undefined);
      await send(new Request(`${FRAMEBRIAR_ENDPOINT}/v1/reports`, { method: "POST", body: "x" }));
      expect(seen).toHaveBeenLastCalledWith("http://127.0.0.1:3400/api/v1/reports", undefined);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "https://example.test/api/v1/reports",
    "http://127.0.0.1:3400/api/v1/reports",
    `${FRAMEBRIAR_ENDPOINT}.evil.test/v1/reports`,
    `${FRAMEBRIAR_ENDPOINT}`,
    "https://framebriar-masra91-poc.azurewebsites.net/other",
  ])("refuses %s and calls nothing", async (url) => {
    const seen = vi.fn();
    vi.stubGlobal("fetch", seen);
    try {
      const send = e2eUpstreamFetch(enabled)!;
      await expect(send(url)).rejects.toThrow(E2E_UPSTREAM_MARKER);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lifts every synthetic account route limit only where the seam is on", () => {
    expect(e2eRouteLimits({})).toBeUndefined();
    const limits = e2eRouteLimits(enabled);
    expect(Object.keys(limits ?? {}).sort()).toEqual(["disconnect", "redeem", "reports", "status"]);
    for (const limit of Object.values(limits ?? {})) expect(limit.limit).toBeGreaterThan(100);
    expect(e2eRouteLimits({ ...enabled, VERCEL: "1" })).toBeUndefined();
    expect(stubbedLimits()).toBeUndefined();
  });

  it("its stub, the one every other build gets, never redirects anything", () => {
    expect(stubbed()).toBeNull();
  });
});
