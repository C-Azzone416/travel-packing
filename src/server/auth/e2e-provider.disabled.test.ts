import { describe, expect, it } from "vitest";
import * as disabled from "./e2e-provider.disabled";
import * as real from "./e2e-provider";

describe("e2e-provider.disabled (what every non-e2e build resolves the provider to)", () => {
  it("can never enable anything, whatever the environment says", () => {
    expect(disabled.e2eAuthEnabled()).toBe(false);
  });

  it("refuses to build a provider", () => {
    expect(() => disabled.createE2eAuthProvider()).toThrow("not compiled into this build");
  });

  it("exposes the same names as the real module, so the alias is a drop-in", () => {
    expect(Object.keys(disabled).sort()).toEqual(Object.keys(real).sort());
  });

  it("holds no cookie name, so the build check's marker only ever matches the real provider", () => {
    expect(disabled.E2E_COOKIE).toBe("");
    expect(real.E2E_COOKIE).toBe("e2e-auth-session");
  });
});
