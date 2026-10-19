// In-memory AuthProvider for tests: no network, no cookies. Tests set who is "signed in".

import type { AuthProvider, AuthSession, FlowResult, SignInResult } from "../types";

export interface FakeUser {
  email: string;
  password: string;
  userId: string;
  /** False = right password but the address is not verified yet (sign-in reports `unverified`). Default true. */
  verified?: boolean;
  /** True = verified, right password, but the password was never set through an emailed link (#83): `unfinished`. */
  unfinished?: boolean;
}

/** Records of the account-flow calls, and what each call answers (set in a test; the default is success). */
export interface FakeFlows {
  calls: { method: string; args: unknown[] }[];
  answers: Partial<Record<string, FlowResult>>;
  /** If set, getSession returns this after a successful verifyEmail (as the provider's auto sign-in would). */
  sessionAfterVerify: AuthSession | null;
}

export interface FakeAuth extends AuthProvider {
  flows: FakeFlows;
  current: AuthSession | null;
  signOutCalls: number;
  failNextGetSession: boolean;
  failNextSignOut: boolean;
}

export function createFakeAuth(users: FakeUser[] = []): FakeAuth {
  const flows: FakeFlows = { calls: [], answers: {}, sessionAfterVerify: null };
  const answer = async (method: string, args: unknown[]) => {
    flows.calls.push({ method, args });
    return (flows.answers[method] ?? { ok: true }) as never;
  };
  const fake: FakeAuth = {
    flows,
    signUp: (...args) => answer("signUp", args),
    async verifyEmail(...args) {
      const result = await answer("verifyEmail", args);
      if ((result as FlowResult).ok && flows.sessionAfterVerify)
        fake.current = flows.sessionAfterVerify;
      return result;
    },
    resendVerificationCode: (...args) => answer("resendVerificationCode", args),
    requestPasswordReset: (...args) => answer("requestPasswordReset", args),
    resetPassword: (...args) => answer("resetPassword", args),
    current: null,
    signOutCalls: 0,
    failNextGetSession: false,
    failNextSignOut: false,
    async getSession() {
      if (fake.failNextGetSession) {
        fake.failNextGetSession = false;
        throw new Error("provider down for secret@example.test");
      }
      return fake.current;
    },
    async signInWithPassword(email, password): Promise<SignInResult> {
      const user = users.find((entry) => entry.email === email && entry.password === password);
      if (!user) return { ok: false };
      if (user.verified === false) return { ok: false, unverified: true };
      if (user.unfinished) return { ok: false, unfinished: true };
      fake.current = { userId: user.userId, email: user.email };
      return { ok: true, session: fake.current };
    },
    async signOut() {
      fake.signOutCalls += 1;
      if (fake.failNextSignOut) {
        fake.failNextSignOut = false;
        throw new Error("provider down for secret@example.test");
      }
      fake.current = null;
    },
  };
  return fake;
}
