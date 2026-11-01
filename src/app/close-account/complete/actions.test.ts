import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getAuth: vi.fn(),
  requestHeaders: new Headers({
    host: "app.example.test",
    origin: "https://app.example.test",
    "x-forwarded-proto": "https",
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/server/auth/auth-runtime", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/server/auth/account-closure-completion", () => ({
  consumeAccountClosureCompletion: mocks.consume,
}));

import { consumeAccountClosureSignalAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHeaders = new Headers({
    host: "app.example.test",
    origin: "https://app.example.test",
    "x-forwarded-proto": "https",
  });
  mocks.getAuth.mockResolvedValue({ available: true, completionSignals: { kind: "synthetic" } });
});

describe("consumeAccountClosureSignalAction", () => {
  it("consumes and returns a valid signal only on a same-origin request", async () => {
    mocks.consume.mockResolvedValue(true);
    await expect(consumeAccountClosureSignalAction()).resolves.toBe(true);
    expect(mocks.consume).toHaveBeenCalledWith({ kind: "synthetic" });
  });

  it("does not read auth or consume a signal for a cross-origin request", async () => {
    mocks.requestHeaders.set("origin", "https://evil.example.test");
    await expect(consumeAccountClosureSignalAction()).resolves.toBe(false);
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("fails closed when auth is unavailable", async () => {
    mocks.getAuth.mockResolvedValue({ available: false });
    await expect(consumeAccountClosureSignalAction()).resolves.toBe(false);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
