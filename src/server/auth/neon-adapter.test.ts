import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNeonAuthProvider, type NeonAuthLike } from "./neon-adapter";
import { setAuthLogSink } from "./safe-log";

type SignInResult = Awaited<ReturnType<NeonAuthLike["signIn"]["email"]>>;
type SessionResult = Awaited<ReturnType<NeonAuthLike["getSession"]>>;
type SignOutResult = Awaited<ReturnType<NeonAuthLike["signOut"]>>;

type CallResult = Awaited<ReturnType<NeonAuthLike["signUp"]["email"]>>;
type Answer = CallResult | (() => Promise<CallResult>);
type SignOutAnswer = SignOutResult | (() => Promise<SignOutResult>);

function fakeNeon(
  overrides: {
    session?: SessionResult | (() => Promise<SessionResult>);
    signIn?: SignInResult | (() => Promise<SignInResult>);
    signUp?: Answer;
    sendOtp?: Answer;
    verify?: Answer;
    requestReset?: Answer;
    reset?: Answer;
    signOut?: SignOutAnswer;
    revokeOtherSessions?: Answer;
    deleteUser?: Answer;
  } = {},
) {
  const calls = {
    getSession: [] as unknown[],
    signOut: 0,
    signIn: [] as { email: string; password: string }[],
    signUp: [] as unknown[],
    sendOtp: [] as unknown[],
    verify: [] as unknown[],
    requestReset: [] as unknown[],
    reset: [] as unknown[],
    revokeOtherSessions: 0,
    deleteUser: [] as unknown[],
  };
  const answer = (value: Answer | undefined): Promise<CallResult> =>
    typeof value === "function" ? value() : Promise.resolve(value ?? { data: {} });
  const neon: NeonAuthLike = {
    async getSession(input) {
      calls.getSession.push(input);
      const value = overrides.session;
      return typeof value === "function" ? value() : (value ?? { data: null });
    },
    signIn: {
      async email(input) {
        calls.signIn.push(input);
        const value = overrides.signIn;
        return typeof value === "function"
          ? value()
          : (value ?? { data: null, error: { message: "bad" } });
      },
    },
    signUp: {
      email(input) {
        calls.signUp.push(input);
        return answer(overrides.signUp);
      },
    },
    emailOtp: {
      sendVerificationOtp(input) {
        calls.sendOtp.push(input);
        return answer(overrides.sendOtp);
      },
      verifyEmail(input) {
        calls.verify.push(input);
        return answer(overrides.verify);
      },
    },
    requestPasswordReset(input) {
      calls.requestReset.push(input);
      return answer(overrides.requestReset);
    },
    resetPassword(input) {
      calls.reset.push(input);
      return answer(overrides.reset);
    },
    signOut() {
      calls.signOut += 1;
      const value = overrides.signOut;
      return typeof value === "function"
        ? value()
        : Promise.resolve(value === undefined ? { data: { success: true }, error: null } : value);
    },
    revokeOtherSessions() {
      calls.revokeOtherSessions += 1;
      return answer(overrides.revokeOtherSessions);
    },
    deleteUser(input) {
      calls.deleteUser.push(input);
      return answer(overrides.deleteUser);
    },
  };
  return { neon, calls };
}

const VERIFIED_USER = {
  id: "u1",
  email: "owner@example.test",
  emailVerified: true,
  createdAt: new Date(1_600_000_000_000),
};

let logged: string[];
beforeEach(() => {
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});

describe("account deletion provider calls", () => {
  it("revokes other sessions and deletes the current identity with the supplied password", async () => {
    const { neon, calls } = fakeNeon({
      revokeOtherSessions: { data: { status: true } },
      deleteUser: { data: { success: true, message: "User deleted" } },
    });
    const provider = createNeonAuthProvider(neon);
    expect(await provider.revokeOtherSessions()).toEqual({ ok: true });
    expect(await provider.deleteUser("synthetic-password")).toEqual({ ok: true });
    expect(calls.revokeOtherSessions).toBe(1);
    expect(calls.deleteUser).toEqual([{ password: "synthetic-password" }]);
  });

  it("uses the runtime's contract-correct revocation call instead of the SDK mapping", async () => {
    const { neon, calls } = fakeNeon({
      revokeOtherSessions: { data: {} },
    });
    const revokeOtherSessions = vi.fn(async () => ({ data: { status: true }, error: null }));
    const provider = createNeonAuthProvider(neon, { revokeOtherSessions });

    expect(await provider.revokeOtherSessions()).toEqual({ ok: true });
    expect(revokeOtherSessions).toHaveBeenCalledOnce();
    expect(calls.revokeOtherSessions).toBe(0);
  });

  it("fails closed when the runtime revocation call throws", async () => {
    const { neon, calls } = fakeNeon({
      revokeOtherSessions: { data: { status: true } },
    });
    const revokeOtherSessions = vi.fn(async () => {
      throw new Error("synthetic revoker failure");
    });
    const provider = createNeonAuthProvider(neon, { revokeOtherSessions });

    await expect(provider.revokeOtherSessions()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(revokeOtherSessions).toHaveBeenCalledOnce();
    expect(calls.revokeOtherSessions).toBe(0);
    expect(logged).toEqual([JSON.stringify({ scope: "auth", event: "provider-error" })]);
  });

  it("does not mistake a verification-email response or an unconfirmed revocation for completed cleanup", async () => {
    const { neon } = fakeNeon({
      revokeOtherSessions: { data: {} },
      deleteUser: { data: { success: true, message: "Verification email sent" } },
    });
    const provider = createNeonAuthProvider(neon);
    expect(await provider.revokeOtherSessions()).toEqual({ ok: false, reason: "unavailable" });
    expect(await provider.deleteUser("synthetic-password")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("fails closed when the installed SDK methods are unavailable", async () => {
    const { neon } = fakeNeon();
    delete neon.revokeOtherSessions;
    delete neon.deleteUser;
    const provider = createNeonAuthProvider(neon);
    expect(await provider.revokeOtherSessions()).toEqual({ ok: false, reason: "unavailable" });
    expect(await provider.deleteUser("synthetic-password")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("maps credential rejection separately from outages without exposing provider details", async () => {
    const invalid = fakeNeon({
      deleteUser: { data: null, error: { status: 401, code: "INVALID_PASSWORD" } },
    });
    expect(await createNeonAuthProvider(invalid.neon).deleteUser("wrong-password")).toEqual({
      ok: false,
      reason: "invalid",
    });
    const down = fakeNeon({
      revokeOtherSessions: { data: null, error: { status: 503, code: "INTERNAL_ERROR" } },
      deleteUser: { data: null, error: { status: 503, code: "INTERNAL_ERROR" } },
    });
    expect(await createNeonAuthProvider(down.neon).revokeOtherSessions()).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await createNeonAuthProvider(down.neon).deleteUser("synthetic-password")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
afterEach(() => setAuthLogSink());

const UNVERIFIED_CASES = [
  ["emailVerified false", { id: "u1", email: "owner@example.test", emailVerified: false }],
  ["emailVerified null", { id: "u1", email: "owner@example.test", emailVerified: null }],
  ["emailVerified missing", { id: "u1", email: "owner@example.test" }],
  [
    "emailVerified the string 'true'",
    { id: "u1", email: "owner@example.test", emailVerified: "true" },
  ],
] as const;

describe("getSession: when the session was made", () => {
  const sessionWith = (createdAt: unknown) =>
    fakeNeon({ session: { data: { user: VERIFIED_USER, session: { createdAt } } } as never });

  it.each([
    ["an ISO string", "2026-10-19T05:00:00.000Z", Date.parse("2026-10-19T05:00:00.000Z")],
    ["a Date", new Date(1_700_000_000_000), 1_700_000_000_000],
    ["a number of milliseconds", 1_700_000_000_000, 1_700_000_000_000],
  ])("reads createdAt as %s", async (_name, createdAt, expected) => {
    const { neon } = sessionWith(createdAt);
    expect(await createNeonAuthProvider(neon).getSession()).toEqual({
      userId: "u1",
      email: "owner@example.test",
      identityCreatedAt: 1_600_000_000_000,
      issuedAt: expected,
    });
  });

  it.each([
    ["missing", undefined],
    ["not a date", "yesterday"],
    ["an object", {}],
    ["null", null],
  ])(
    "leaves issuedAt out when createdAt is %s (the setup gate then refuses the session)",
    async (_name, createdAt) => {
      const { neon } = sessionWith(createdAt);
      expect(await createNeonAuthProvider(neon).getSession()).toEqual({
        userId: "u1",
        email: "owner@example.test",
        identityCreatedAt: 1_600_000_000_000,
      });
    },
  );
});

describe("getSession", () => {
  it("forces an authoritative upstream read instead of accepting the signed session-data cache", async () => {
    const { neon, calls } = fakeNeon({ session: { data: { user: VERIFIED_USER } } });
    await createNeonAuthProvider(neon).getSession();
    expect(calls.getSession).toEqual([{ query: { disableCookieCache: "true" } }]);
  });

  it("maps a verified SDK user to a session", async () => {
    const { neon } = fakeNeon({ session: { data: { user: VERIFIED_USER } } });
    expect(await createNeonAuthProvider(neon).getSession()).toEqual({
      userId: "u1",
      email: "owner@example.test",
      identityCreatedAt: 1_600_000_000_000,
    });
  });

  const signedOutCases: [string, unknown][] = [
    ["no result", null],
    ["no data", { data: null }],
    ["no user", { data: { user: null } }],
    [
      "a user without an id",
      { data: { user: { email: "owner@example.test", emailVerified: true } } },
    ],
    ["a user without an email", { data: { user: { id: "u1", emailVerified: true } } }],
    [
      "an error alongside a verified user",
      { data: { user: VERIFIED_USER }, error: { message: "x" } },
    ],
    ...UNVERIFIED_CASES.map(([name, user]): [string, unknown] => [
      `an unverified email (${name})`,
      { data: { user } },
    ]),
  ];

  it.each(signedOutCases)("is signed out for %s", async (_name, session) => {
    const { neon } = fakeNeon({ session: session as unknown as SessionResult });
    expect(await createNeonAuthProvider(neon).getSession()).toBeNull();
  });
});

describe("signInWithPassword", () => {
  it("passes credentials through and maps a verified user", async () => {
    const { neon, calls } = fakeNeon({ signIn: { data: { user: VERIFIED_USER } } });
    const result = await createNeonAuthProvider(neon).signInWithPassword(
      "owner@example.test",
      "pw",
    );
    expect(result).toEqual({
      ok: true,
      session: {
        userId: "u1",
        email: "owner@example.test",
        identityCreatedAt: 1_600_000_000_000,
      },
    });
    expect(calls.signIn).toEqual([{ email: "owner@example.test", password: "pw" }]);
  });

  const failedCases: [string, unknown][] = [
    ["an API error", { data: null, error: { message: "Invalid credentials" } }],
    ["no result", null],
    ["a result without a user", { data: { user: null } }],
    [
      "an error alongside a verified user (fails closed on the error)",
      { data: { user: VERIFIED_USER }, error: { message: "x" } },
    ],
  ];

  it.each(UNVERIFIED_CASES)(
    "reports an unverified email (%s) as unverified, with no session",
    async (_name, user) => {
      const { neon } = fakeNeon({ signIn: { data: { user } } as unknown as SignInResult });
      expect(await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw")).toEqual(
        {
          ok: false,
          unverified: true,
          diagnostic: { reason: "email-unverified" },
        },
      );
    },
  );

  it.each(failedCases)(
    "fails generically on %s while retaining a bounded diagnostic",
    async (_name, signIn) => {
      const { neon } = fakeNeon({ signIn: signIn as unknown as SignInResult });
      const result = await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw");
      expect(result).toMatchObject({ ok: false, diagnostic: { reason: expect.any(String) } });
      expect(JSON.stringify(result)).not.toContain("Invalid credentials");
      expect(JSON.stringify(result)).not.toContain("owner@example.test");
    },
  );

  it("classifies a thrown SDK error as unavailable without logging its contents", async () => {
    const { neon } = fakeNeon({
      signIn: async () => {
        throw new Error("connect ECONNREFUSED for a@example.test with password hunter2");
      },
    });
    expect(
      await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "hunter2"),
    ).toEqual({
      ok: false,
      diagnostic: { reason: "provider-unavailable" },
    });
    expect(logged).toEqual([]);
  });

  it.each([
    [
      "rejected credentials",
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      "credentials-rejected",
    ],
    ["provider throttling", { status: 429, code: "TOO_MANY_ATTEMPTS" }, "provider-rate-limited"],
    ["provider outage", { status: 503, code: "INTERNAL_ERROR" }, "provider-unavailable"],
    [
      "session creation failure",
      { status: 401, code: "FAILED_TO_CREATE_SESSION" },
      "session-not-created",
    ],
    ["other client rejection", { status: 403, code: "INVALID_ORIGIN" }, "provider-rejected"],
  ])("classifies %s from safe response facts", async (_name, error, reason) => {
    const { neon } = fakeNeon({ signIn: { data: null, error } });
    expect(await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw")).toEqual({
      ok: false,
      diagnostic: { reason, rejection: error },
    });
  });

  it.each([
    ["an unknown code on a 401", { status: 401, code: "SOMETHING_ELSE" }, "provider-rejected"],
    [
      "a recognized internal error on a 401",
      { status: 401, code: "INTERNAL_ERROR" },
      "provider-unavailable",
    ],
    [
      "a recognized credential rejection on a conflicting 503",
      { status: 503, code: "INVALID_EMAIL_OR_PASSWORD" },
      "credentials-rejected",
    ],
    [
      "a recognized attempt limit on a conflicting 401",
      { status: 401, code: "TOO_MANY_ATTEMPTS" },
      "provider-rate-limited",
    ],
    [
      "an unknown code on an unambiguous 503",
      { status: 503, code: "SOMETHING_ELSE" },
      "provider-unavailable",
    ],
  ])("uses bounded evidence for %s", async (_name, error, reason) => {
    const { neon } = fakeNeon({ signIn: { data: null, error } });
    expect(await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw")).toEqual({
      ok: false,
      diagnostic: { reason, rejection: error },
    });
  });

  it("keeps a status-only 401 generic", async () => {
    const { neon } = fakeNeon({ signIn: { data: null, error: { status: 401 } } });
    expect(await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw")).toEqual({
      ok: false,
      diagnostic: {
        reason: "provider-rejected",
        rejection: { status: 401, code: "" },
      },
    });
  });
});

describe("signOut", () => {
  it("delegates to the SDK", async () => {
    const { neon, calls } = fakeNeon();
    await createNeonAuthProvider(neon).signOut();
    expect(calls.signOut).toBe(1);
  });

  it.each([
    [
      "a resolved SDK error",
      {
        data: null,
        error: {
          status: 503,
          code: "INTERNAL_ERROR",
          message: "provider response for owner@example.test",
        },
      },
    ],
    ["an empty SDK response", null],
  ])("rejects %s with a fixed safe error", async (_name, signOut) => {
    const { neon } = fakeNeon({ signOut: signOut as SignOutResult });
    await expect(createNeonAuthProvider(neon).signOut()).rejects.toThrow(
      "Auth provider sign-out failed",
    );
    expect(logged.join()).not.toContain("owner@example.test");
    expect(logged).toEqual([]);
  });

  it("replaces a thrown SDK error with a fixed safe error", async () => {
    const { neon } = fakeNeon({
      signOut: async () => {
        throw new Error("cookie for owner@example.test failed");
      },
    });
    await expect(createNeonAuthProvider(neon).signOut()).rejects.toThrow(
      "Auth provider sign-out failed",
    );
    expect(logged).toEqual([]);
  });
});

describe("account flows", () => {
  const fail = (status: number, code = "SOME_CODE") => ({ data: null, error: { status, code } });

  describe("signUp", () => {
    it("creates the account with the address, the password and a display name from the address", async () => {
      const { neon, calls } = fakeNeon();
      expect(
        await createNeonAuthProvider(neon).signUp("owner@example.test", "a-long-password"),
      ).toEqual({
        ok: true,
      });
      expect(calls.signUp).toEqual([
        { email: "owner@example.test", password: "a-long-password", name: "owner" },
      ]);
    });

    it("reports a taken address (or any other client error) as success so it cannot be told apart", async () => {
      // The screen sees "ok" for all of these; the status and machine code ride along only for the server's log.
      const expected = [
        [fail(422, "USER_ALREADY_EXISTS"), { status: 422, code: "USER_ALREADY_EXISTS" }],
        [fail(400), { status: 400, code: "SOME_CODE" }],
        [fail(403, "INVALID_ORIGIN"), { status: 403, code: "INVALID_ORIGIN" }],
      ] as const;
      for (const [failure, rejected] of expected) {
        const { neon } = fakeNeon({ signUp: failure });
        expect(
          await createNeonAuthProvider(neon).signUp("a@example.test", "a-long-password"),
        ).toEqual({ ok: true, rejected });
      }
      const created = fakeNeon({});
      expect(
        await createNeonAuthProvider(created.neon).signUp("a@example.test", "a-long-password"),
      ).toEqual({ ok: true });
    });

    it("surfaces a refused password and an outage, and nothing else", async () => {
      const weak = fakeNeon({ signUp: fail(400, "PASSWORD_TOO_SHORT") });
      expect(await createNeonAuthProvider(weak.neon).signUp("a@example.test", "x")).toEqual({
        ok: false,
        reason: "weak-password",
      });
      for (const outage of [fail(500), fail(0, "NETWORK_TIMEOUT"), { data: null, error: {} }]) {
        const { neon } = fakeNeon({ signUp: outage });
        expect(
          await createNeonAuthProvider(neon).signUp("a@example.test", "a-long-password"),
        ).toEqual({
          ok: false,
          reason: "unavailable",
        });
      }
    });

    it("treats a thrown error and an empty answer as an outage, logging only a code", async () => {
      const thrown = fakeNeon({
        signUp: async () => {
          throw new Error("boom for secret@example.test");
        },
      });
      expect(
        await createNeonAuthProvider(thrown.neon).signUp("a@example.test", "pw-long-enough"),
      ).toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(logged).toEqual([JSON.stringify({ scope: "auth", event: "provider-error" })]);
      const empty = fakeNeon({ signUp: async () => null });
      expect(
        await createNeonAuthProvider(empty.neon).signUp("a@example.test", "pw-long-enough"),
      ).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });
  });

  describe("verifyEmail", () => {
    it("sends the address and the code", async () => {
      const { neon, calls } = fakeNeon();
      expect(await createNeonAuthProvider(neon).verifyEmail("a@example.test", "123456")).toEqual({
        ok: true,
      });
      expect(calls.verify).toEqual([{ email: "a@example.test", otp: "123456" }]);
    });

    it.each([
      ["a wrong or expired code", fail(400, "INVALID_OTP"), "invalid"],
      ["an unknown address", fail(404, "USER_NOT_FOUND"), "invalid"],
      ["the attempt limit (the code is voided)", fail(403, "TOO_MANY_ATTEMPTS"), "locked"],
      ["a 429", fail(429), "too-many"],
      ["a server error", fail(503), "unavailable"],
      ["a password code (not meaningful here)", fail(400, "PASSWORD_TOO_SHORT"), "invalid"],
    ])("maps %s", async (_name, answer, reason) => {
      const { neon } = fakeNeon({ verify: answer });
      expect(await createNeonAuthProvider(neon).verifyEmail("a@example.test", "1")).toEqual({
        ok: false,
        reason,
      });
    });
  });

  describe("sending codes and links", () => {
    it("asks for a verification code with the verification type", async () => {
      const { neon, calls } = fakeNeon();
      expect(await createNeonAuthProvider(neon).resendVerificationCode("a@example.test")).toEqual({
        ok: true,
      });
      expect(calls.sendOtp).toEqual([{ email: "a@example.test", type: "email-verification" }]);
    });

    it("asks for a reset link that returns to the app's own reset page", async () => {
      const { neon, calls } = fakeNeon();
      expect(
        await createNeonAuthProvider(neon).requestPasswordReset(
          "a@example.test",
          "https://app.example.test/reset-password",
        ),
      ).toEqual({ ok: true });
      expect(calls.requestReset).toEqual([
        { email: "a@example.test", redirectTo: "https://app.example.test/reset-password" },
      ]);
    });

    it("reports success for an unknown address, and only limits and outages as failures", async () => {
      const unknown = fakeNeon({ sendOtp: fail(404, "USER_NOT_FOUND"), requestReset: fail(404) });
      const provider = createNeonAuthProvider(unknown.neon);
      expect(await provider.resendVerificationCode("x@example.test")).toEqual({
        ok: true,
        rejected: { status: 404, code: "USER_NOT_FOUND" },
      });
      expect(await provider.requestPasswordReset("x@example.test", "https://a.test/r")).toEqual({
        ok: true,
        rejected: { status: 404, code: "SOME_CODE" },
      });
      const limited = fakeNeon({ sendOtp: fail(429), requestReset: fail(429) });
      expect(
        await createNeonAuthProvider(limited.neon).resendVerificationCode("x@example.test"),
      ).toEqual({ ok: false, reason: "too-many" });
      const down = fakeNeon({ sendOtp: fail(502), requestReset: fail(502) });
      expect(
        await createNeonAuthProvider(down.neon).requestPasswordReset(
          "x@example.test",
          "https://a.test/r",
        ),
      ).toEqual({ ok: false, reason: "unavailable" });
    });
  });

  describe("resetPassword", () => {
    it("sends the token and the new password", async () => {
      const { neon, calls } = fakeNeon();
      expect(
        await createNeonAuthProvider(neon).resetPassword("fake-token-one", "new-password-1"),
      ).toEqual({
        ok: true,
      });
      expect(calls.reset).toEqual([{ token: "fake-token-one", newPassword: "new-password-1" }]);
    });

    it.each([
      ["a refused password", fail(400, "PASSWORD_TOO_LONG"), "weak-password"],
      ["an invalid or expired token", fail(400, "INVALID_TOKEN"), "invalid"],
      ["the attempt limit (meaningless for a token)", fail(403, "TOO_MANY_ATTEMPTS"), "invalid"],
      ["a 429", fail(429), "too-many"],
      ["an outage", fail(500), "unavailable"],
    ])("maps %s", async (_name, answer, reason) => {
      const { neon } = fakeNeon({ reset: answer });
      expect(
        await createNeonAuthProvider(neon).resetPassword("fake-token-one", "new-password-1"),
      ).toEqual({
        ok: false,
        reason,
      });
    });
  });

  describe("sign-in with an unverified account", () => {
    it("reports the right password with an unverified address as unverified, never as a session", async () => {
      for (const signIn of [
        { data: null, error: { status: 403, code: "EMAIL_NOT_VERIFIED" } },
        { data: { user: { id: "u1", email: "a@example.test", emailVerified: false } } },
        { data: { user: { id: "u1", email: "a@example.test" } } },
      ]) {
        const { neon } = fakeNeon({ signIn });
        expect(
          await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw"),
        ).toEqual({
          ok: false,
          unverified: true,
          diagnostic: {
            reason: "email-unverified",
            ...(signIn.error ? { rejection: { status: 403, code: "EMAIL_NOT_VERIFIED" } } : {}),
          },
        });
      }
    });

    it("distinguishes rejected credentials from an invalid empty response", async () => {
      const rejected = fakeNeon({
        signIn: {
          data: null,
          error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
        },
      });
      expect(
        await createNeonAuthProvider(rejected.neon).signInWithPassword("a@example.test", "pw"),
      ).toEqual({
        ok: false,
        diagnostic: {
          reason: "credentials-rejected",
          rejection: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
        },
      });
      const empty = fakeNeon({ signIn: { data: null } });
      expect(
        await createNeonAuthProvider(empty.neon).signInWithPassword("a@example.test", "pw"),
      ).toEqual({ ok: false, diagnostic: { reason: "provider-response-invalid" } });
    });
  });
});
