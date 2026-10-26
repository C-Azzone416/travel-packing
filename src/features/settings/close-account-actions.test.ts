import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeAccount: vi.fn(),
  deletionSession: vi.fn(),
  getAuth: vi.fn(),
  getAppDb: vi.fn(),
  issueCompletion: vi.fn(),
  cookieDelete: vi.fn(),
  requestHeaders: new Headers({
    host: "app.example.test",
    origin: "https://app.example.test",
    "x-forwarded-for": "203.0.113.8",
    "x-forwarded-proto": "https",
  }),
}));

vi.mock("@/server/auth/auth-runtime", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/server/db/app-db", () => ({ getAppDb: mocks.getAppDb }));
vi.mock("@/server/auth/account-closure-completion", () => ({
  ACCOUNT_CLOSURE_COMPLETE_PATH: "/close-account/complete",
  issueAccountClosureCompletion: mocks.issueCompletion,
}));
vi.mock("@/server/auth/close-account", () => ({
  closeAccount: mocks.closeAccount,
  deletionSession: mocks.deletionSession,
}));
vi.mock("next/headers", () => ({
  headers: async () => mocks.requestHeaders,
  cookies: async () => ({ get: () => undefined, delete: mocks.cookieDelete }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import { closeAccountAction, retryCloseAccountAction } from "./close-account-actions";
import { INITIAL_CLOSE_ACCOUNT_STATE } from "./close-account-state";
import { resetSignInLimits } from "@/server/auth/sign-in-limit";

const SESSION = { userId: "synthetic-owner", email: "owner@example.test" };
const db = { kind: "synthetic-db" };
const blocked = vi.fn(async () => true);
const auth = {
  available: true,
  setup: { isAccountDeletionBlocked: blocked },
  completionSignals: { kind: "synthetic-completion-signals" },
};

function form(password = "synthetic-password", confirmation = "DELETE") {
  const data = new FormData();
  data.set("password", password);
  data.set("confirmation", confirmation);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSignInLimits();
  mocks.requestHeaders = new Headers({
    host: "app.example.test",
    origin: "https://app.example.test",
    "x-forwarded-for": "203.0.113.8",
    "x-forwarded-proto": "https",
  });
  mocks.getAuth.mockResolvedValue(auth);
  mocks.getAppDb.mockResolvedValue(db);
  mocks.deletionSession.mockResolvedValue(SESSION);
  mocks.issueCompletion.mockResolvedValue(true);
  blocked.mockResolvedValue(true);
});

describe("closeAccountAction", () => {
  it("requires a same-origin request before reading auth or touching data", async () => {
    mocks.requestHeaders.set("origin", "https://evil.example.test");
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toMatchObject({
      error: expect.stringContaining("Nothing was deleted"),
    });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("requires both the current password and exact DELETE confirmation", async () => {
    await expect(
      closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form("", "delete")),
    ).resolves.toEqual({
      error: null,
      fieldErrors: {
        password: "Enter your current password.",
        confirmation: "Type DELETE exactly to confirm.",
      },
    });
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("uses only the server session identity and reports success only after the core confirms it", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/close-account/complete",
    );
    expect(mocks.closeAccount).toHaveBeenCalledWith(auth, db, SESSION, "synthetic-password");
    expect(mocks.issueCompletion).toHaveBeenCalledWith(auth.completionSignals);
    expect(mocks.cookieDelete).toHaveBeenCalledWith("appearance");
  });

  it("falls back to sign-in safely if the post-deletion completion signal cannot be issued", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    mocks.issueCompletion.mockResolvedValue(false);
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in?notice=account-closed",
    );
  });

  it("makes a post-purge provider failure explicit and links to recovery", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unavailable", deletionStarted: true });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toMatchObject({
      error: expect.stringContaining("data is removed"),
      recovery: true,
    });
    expect(mocks.issueCompletion).not.toHaveBeenCalled();
  });

  it("does not claim nothing was deleted when the transaction result is ambiguous", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unavailable", deletionStarted: "unknown" });
    const result = await closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form());
    expect(result).toMatchObject({
      error: expect.stringContaining("couldn’t confirm whether account closure started"),
      recovery: true,
    });
    expect(result.error).not.toContain("Nothing was deleted");
    expect(mocks.issueCompletion).not.toHaveBeenCalled();
  });
});

describe("retryCloseAccountAction", () => {
  it("cannot be used for an active account without a durable deletion fence", async () => {
    blocked.mockResolvedValue(false);
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/settings",
    );
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("retries an already-fenced deletion idempotently", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unavailable", deletionStarted: true });
    await expect(
      retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form()),
    ).resolves.toMatchObject({
      recovery: true,
    });
    expect(blocked).toHaveBeenCalledWith(SESSION.userId);
    expect(mocks.closeAccount).toHaveBeenCalledWith(auth, db, SESSION, "synthetic-password");
    expect(mocks.issueCompletion).not.toHaveBeenCalled();
  });

  it("issues the completion signal after a retry reaches confirmed terminal deletion", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/close-account/complete",
    );
    expect(mocks.issueCompletion).toHaveBeenCalledWith(auth.completionSignals);
  });
});
