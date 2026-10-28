import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeAccount: vi.fn(),
  deletionSession: vi.fn(),
  getAuth: vi.fn(),
  getAppDb: vi.fn(),
  issueCompletion: vi.fn(),
  cookieDelete: vi.fn(),
  forgetPendingEmail: vi.fn(),
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
vi.mock("@/server/auth/pending-email", () => ({
  forgetPendingEmail: mocks.forgetPendingEmail,
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
  vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "1");
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
  mocks.forgetPendingEmail.mockResolvedValue(undefined);
  blocked.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("closeAccountAction", () => {
  it("rejects a direct action call while rollout is off before reading request, auth or data", async () => {
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "");
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: "Account closure is not available right now. Nothing was deleted.",
      fieldErrors: {},
    });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.getAppDb).not.toHaveBeenCalled();
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

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

  it.each([
    ["auth", { available: false }, db],
    ["database", auth, null],
  ])("fails safely when the %s runtime is unavailable", async (_name, nextAuth, nextDb) => {
    mocks.getAuth.mockResolvedValue(nextAuth);
    mocks.getAppDb.mockResolvedValue(nextDb);
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toMatchObject({
      error: expect.stringContaining("Nothing was deleted"),
    });
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("requires a current raw provider session", async () => {
    mocks.deletionSession.mockResolvedValue(null);
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("rate-limits repeated password failures before another provider call", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "wrong-password" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form());
    }
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toMatchObject({
      error: expect.stringContaining("Too many attempts"),
    });
    expect(mocks.closeAccount).toHaveBeenCalledTimes(10);
  });

  it("attaches a wrong-password error to the password field", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "wrong-password" });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: null,
      fieldErrors: { password: "That password wasn’t correct." },
    });
  });

  it("redirects if fresh authentication no longer matches a session", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unauthenticated" });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("uses only the server session identity and reports success only after the core confirms it", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/close-account/complete",
    );
    expect(mocks.closeAccount).toHaveBeenCalledWith(auth, db, SESSION, "synthetic-password");
    expect(mocks.issueCompletion).toHaveBeenCalledWith(auth.completionSignals);
    expect(mocks.cookieDelete).toHaveBeenCalledWith("appearance");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("anon-appearance");
  });

  it("falls back to sign-in safely if the post-deletion completion signal cannot be issued", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    mocks.issueCompletion.mockResolvedValue(false);
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in?notice=account-closed",
    );
  });

  it("still completes the redirect when best-effort local cookie cleanup fails", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "ok" });
    mocks.cookieDelete.mockImplementationOnce(() => {
      throw new Error("synthetic cookie failure");
    });
    mocks.forgetPendingEmail.mockRejectedValueOnce(new Error("synthetic pending-email failure"));
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/close-account/complete",
    );
  });

  it("makes a pre-purge provider failure explicit without offering fenced recovery", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unavailable", deletionStarted: false });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: "We couldn’t close your account. Nothing was deleted. Try again.",
      fieldErrors: {},
    });
  });

  it("makes a post-purge provider failure explicit and links to recovery", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unavailable", deletionStarted: true });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toMatchObject({
      error: expect.stringContaining("content is removed"),
      recovery: true,
    });
    expect(mocks.issueCompletion).not.toHaveBeenCalled();
  });

  it("does not claim completion or offer provider recovery when only final fence cleanup is pending", async () => {
    mocks.closeAccount.mockResolvedValue({
      status: "unavailable",
      deletionStarted: true,
      providerDeleted: true,
    });
    await expect(closeAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error:
        "Your identity and Packed Smart content were deleted, but removal of a temporary closure marker couldn’t be confirmed. Do not create a new account yet.",
      fieldErrors: {},
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
  it("rejects direct retry and reconciliation while rollout is off", async () => {
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "invalid");
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: "Account closure is not available right now. Nothing was deleted.",
      fieldErrors: {},
      recovery: true,
    });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.getAppDb).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("requires a same-origin retry before reading auth", async () => {
    mocks.requestHeaders.set("origin", "https://evil.example.test");
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: "We couldn’t close your account. Nothing was deleted. Try again.",
      fieldErrors: {},
    });
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it("requires both retry confirmation fields and preserves recovery state", async () => {
    await expect(
      retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form("", "delete")),
    ).resolves.toEqual({
      error: null,
      fieldErrors: {
        password: "Enter your current password.",
        confirmation: "Type DELETE exactly to confirm.",
      },
      recovery: true,
    });
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["password", form("", "DELETE"), { password: "Enter your current password." }],
    [
      "confirmation",
      form("synthetic-password", "delete"),
      { confirmation: "Type DELETE exactly to confirm." },
    ],
  ])("reports only the invalid retry %s field", async (_name, input, fieldErrors) => {
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, input)).resolves.toEqual({
      error: null,
      fieldErrors,
      recovery: true,
    });
  });

  it("rejects non-text retry fields", async () => {
    const input = new FormData();
    input.set("password", new Blob(["synthetic-password"]));
    input.set("confirmation", new Blob(["DELETE"]));
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, input)).resolves.toEqual({
      error: null,
      fieldErrors: {
        password: "Enter your current password.",
        confirmation: "Type DELETE exactly to confirm.",
      },
      recovery: true,
    });
  });

  it.each([
    ["auth", { available: false }, db],
    ["database", auth, null],
  ])(
    "keeps recovery available when the %s runtime is unavailable",
    async (_name, nextAuth, nextDb) => {
      mocks.getAuth.mockResolvedValue(nextAuth);
      mocks.getAppDb.mockResolvedValue(nextDb);
      await expect(
        retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form()),
      ).resolves.toMatchObject({
        error: expect.stringContaining("content is removed"),
        recovery: true,
      });
    },
  );

  it("requires a current raw provider session for a retry", async () => {
    mocks.deletionSession.mockResolvedValue(null);
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("keeps recovery available when the deletion fence cannot be read", async () => {
    blocked.mockRejectedValueOnce(new Error("synthetic fence lookup failure"));
    await expect(
      retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form()),
    ).resolves.toMatchObject({
      error: expect.stringContaining("content is removed"),
      recovery: true,
    });
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("cannot be used for an active account without a transient deletion fence", async () => {
    blocked.mockResolvedValue(false);
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/settings",
    );
    expect(mocks.closeAccount).not.toHaveBeenCalled();
  });

  it("treats a missing fence capability as an active account", async () => {
    mocks.getAuth.mockResolvedValue({ ...auth, setup: {} });
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/settings",
    );
  });

  it("rate-limits repeated retry password failures", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "wrong-password" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form());
    }
    await expect(
      retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form()),
    ).resolves.toMatchObject({
      error: expect.stringContaining("Too many attempts"),
      recovery: true,
    });
    expect(mocks.closeAccount).toHaveBeenCalledTimes(10);
  });

  it("attaches a retry wrong-password error to the password field", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "wrong-password" });
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error: null,
      fieldErrors: { password: "That password wasn’t correct." },
      recovery: true,
    });
  });

  it("redirects when retry authentication no longer matches a session", async () => {
    mocks.closeAccount.mockResolvedValue({ status: "unauthenticated" });
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
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

  it("does not offer another provider retry after identity deletion if final fence cleanup is pending", async () => {
    mocks.closeAccount.mockResolvedValue({
      status: "unavailable",
      deletionStarted: true,
      providerDeleted: true,
    });
    await expect(retryCloseAccountAction(INITIAL_CLOSE_ACCOUNT_STATE, form())).resolves.toEqual({
      error:
        "Your identity and Packed Smart content were deleted, but removal of a temporary closure marker couldn’t be confirmed. Do not create a new account yet.",
      fieldErrors: {},
    });
    expect(mocks.issueCompletion).not.toHaveBeenCalled();
  });
});
