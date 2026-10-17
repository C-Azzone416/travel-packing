import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNeonAuthProvider, type NeonAuthLike } from "./neon-adapter";
import { setAuthLogSink } from "./safe-log";

type SignInResult = Awaited<ReturnType<NeonAuthLike["signIn"]["email"]>>;
type SessionResult = Awaited<ReturnType<NeonAuthLike["getSession"]>>;

function fakeNeon(
  overrides: {
    session?: SessionResult | (() => Promise<SessionResult>);
    signIn?: SignInResult | (() => Promise<SignInResult>);
  } = {},
) {
  const calls = { signOut: 0, signIn: [] as { email: string; password: string }[] };
  const neon: NeonAuthLike = {
    async getSession() {
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
    async signOut() {
      calls.signOut += 1;
    },
  };
  return { neon, calls };
}

let logged: string[];
beforeEach(() => {
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});
afterEach(() => setAuthLogSink());

describe("getSession", () => {
  it("maps the SDK user to a session", async () => {
    const { neon } = fakeNeon({
      session: { data: { user: { id: "u1", email: "owner@example.test" } } },
    });
    expect(await createNeonAuthProvider(neon).getSession()).toEqual({
      userId: "u1",
      email: "owner@example.test",
    });
  });

  it.each([
    ["no result", null],
    ["no data", { data: null }],
    ["no user", { data: { user: null } }],
    ["a user without an id", { data: { user: { email: "owner@example.test" } } }],
    ["a user without an email", { data: { user: { id: "u1" } } }],
    [
      "an error alongside a user",
      { data: { user: { id: "u1", email: "owner@example.test" } }, error: { message: "x" } },
    ],
  ])("is signed out for %s", async (_name, session) => {
    const { neon } = fakeNeon({ session: session as SessionResult });
    expect(await createNeonAuthProvider(neon).getSession()).toBeNull();
  });
});

describe("signInWithPassword", () => {
  it("passes credentials through and maps the user", async () => {
    const { neon, calls } = fakeNeon({
      signIn: { data: { user: { id: "u1", email: "owner@example.test" } } },
    });
    const result = await createNeonAuthProvider(neon).signInWithPassword(
      "owner@example.test",
      "pw",
    );
    expect(result).toEqual({ ok: true, session: { userId: "u1", email: "owner@example.test" } });
    expect(calls.signIn).toEqual([{ email: "owner@example.test", password: "pw" }]);
  });

  it.each([
    ["an API error", { data: null, error: { message: "Invalid credentials" } }],
    ["no result", null],
    ["a result without a user", { data: { user: null } }],
  ])("fails generically on %s", async (_name, signIn) => {
    const { neon } = fakeNeon({ signIn: signIn as SignInResult });
    expect(await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "pw")).toEqual({
      ok: false,
    });
  });

  it("treats a thrown SDK error as a failed sign-in and logs nothing from it", async () => {
    const { neon } = fakeNeon({
      signIn: async () => {
        throw new Error("connect ECONNREFUSED for a@example.test with password hunter2");
      },
    });
    expect(
      await createNeonAuthProvider(neon).signInWithPassword("a@example.test", "hunter2"),
    ).toEqual({ ok: false });
    expect(logged).toEqual([JSON.stringify({ scope: "auth", event: "provider-error" })]);
  });
});

describe("signOut", () => {
  it("delegates to the SDK", async () => {
    const { neon, calls } = fakeNeon();
    await createNeonAuthProvider(neon).signOut();
    expect(calls.signOut).toBe(1);
  });
});
