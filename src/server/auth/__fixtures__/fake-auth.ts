// In-memory AuthProvider for tests: no network, no cookies. Tests set who is "signed in".

import type { AuthProvider, AuthSession, SignInResult } from "../types";

export interface FakeUser {
  email: string;
  password: string;
  userId: string;
}

export interface FakeAuth extends AuthProvider {
  current: AuthSession | null;
  signOutCalls: number;
  failNextGetSession: boolean;
  failNextSignOut: boolean;
}

export function createFakeAuth(users: FakeUser[] = []): FakeAuth {
  const fake: FakeAuth = {
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
