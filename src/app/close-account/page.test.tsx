import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  deletionSession: vi.fn(),
  blocked: vi.fn(),
}));

vi.mock("@/server/auth/auth-runtime", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/server/auth/close-account", () => ({ deletionSession: mocks.deletionSession }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("./RetryCloseAccountForm", () => ({
  RetryCloseAccountForm: () => <p>synthetic recovery form</p>,
}));

import CloseAccountPage from "./page";

const auth = {
  available: true,
  setup: { isAccountDeletionBlocked: mocks.blocked },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "1");
  mocks.getAuth.mockResolvedValue(auth);
  mocks.deletionSession.mockResolvedValue({
    userId: "synthetic-owner",
    email: "owner@example.test",
  });
  mocks.blocked.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("CloseAccountPage", () => {
  it("hides the recovery mutation route while rollout is off before reading auth", async () => {
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "");
    await expect(CloseAccountPage()).rejects.toThrow("REDIRECT:/settings");
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.deletionSession).not.toHaveBeenCalled();
    expect(mocks.blocked).not.toHaveBeenCalled();
  });

  it("shows synthetic recovery only for an enabled, authenticated, fenced deletion", async () => {
    expect(renderToStaticMarkup(await CloseAccountPage())).toContain("synthetic recovery form");
    expect(mocks.blocked).toHaveBeenCalledWith("synthetic-owner");
  });

  it("does not expose recovery for an enabled active account without a fence", async () => {
    mocks.blocked.mockResolvedValue(false);
    await expect(CloseAccountPage()).rejects.toThrow("REDIRECT:/settings");
  });
});
