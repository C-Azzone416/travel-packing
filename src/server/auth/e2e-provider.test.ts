import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { createE2eAuthProvider, e2eAuthEnabled, E2E_COOKIE } from "./e2e-provider";

const dir = mkdtempSync(join(tmpdir(), "e2e-sessions-"));
const env = {
  AUTH_E2E_FAKE: "1",
  AUTH_E2E_PASSWORD: "synthetic-e2e-only",
  AUTH_E2E_STATE_DIR: dir,
};

beforeEach(() => {
  jar.clear();
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("e2eAuthEnabled", () => {
  it("needs the opt-in, a password, and a state directory", () => {
    expect(e2eAuthEnabled(env)).toBe(true);
    expect(e2eAuthEnabled({})).toBe(false);
    expect(e2eAuthEnabled({ ...env, AUTH_E2E_FAKE: "0" })).toBe(false);
    expect(e2eAuthEnabled({ ...env, AUTH_E2E_FAKE: "true" })).toBe(false);
    expect(e2eAuthEnabled({ ...env, AUTH_E2E_PASSWORD: "" })).toBe(false);
    expect(e2eAuthEnabled({ ...env, AUTH_E2E_PASSWORD: undefined })).toBe(false);
    expect(e2eAuthEnabled({ ...env, AUTH_E2E_STATE_DIR: "" })).toBe(false);
  });

  it.each([
    ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["any Vercel runtime", { VERCEL: "1" }],
  ])("is never enabled on a Vercel %s deployment", (_name, vercel) => {
    expect(e2eAuthEnabled({ ...env, ...vercel })).toBe(false);
  });
});

describe("createE2eAuthProvider", () => {
  const provider = createE2eAuthProvider(env);
  const OWNER = "owner@example.test";

  it("starts signed out", async () => {
    expect(await provider.getSession()).toBeNull();
  });

  it("signs in with the synthetic password and keeps an unguessable token, not the email, in the cookie", async () => {
    expect(await provider.signInWithPassword(OWNER, env.AUTH_E2E_PASSWORD)).toEqual({
      ok: true,
      session: { userId: `e2e-${OWNER}`, email: OWNER },
    });
    const token = jar.get(E2E_COOKIE) ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain("owner");
    expect(await provider.getSession()).toEqual({ userId: `e2e-${OWNER}`, email: OWNER });
  });

  it("mints a different token for every sign-in, and each session keeps its own email", async () => {
    await provider.signInWithPassword(OWNER, env.AUTH_E2E_PASSWORD);
    const first = jar.get(E2E_COOKIE);
    await provider.signInWithPassword("second@example.test", env.AUTH_E2E_PASSWORD);
    const second = jar.get(E2E_COOKIE);
    expect(first).not.toBe(second);
    jar.set(E2E_COOKIE, first ?? "");
    expect((await provider.getSession())?.email).toBe(OWNER);
    jar.set(E2E_COOKIE, second ?? "");
    expect((await provider.getSession())?.email).toBe("second@example.test");
  });

  it("rejects a wrong password and mints nothing", async () => {
    expect(await provider.signInWithPassword(OWNER, "nope")).toEqual({ ok: false });
    expect(jar.size).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rejects everything when no password is configured", async () => {
    expect(
      await createE2eAuthProvider({ AUTH_E2E_STATE_DIR: dir }).signInWithPassword(OWNER, ""),
    ).toEqual({ ok: false });
  });

  describe("forged cookies are rejected: knowing the owner's email is not enough", () => {
    it.each([
      ["the plaintext email", OWNER],
      ["a well-formed token that was never minted", "a".repeat(64)],
      ["an upper-case token", "A".repeat(64)],
      ["a token that is too short", "ab12"],
      ["a token that is too long", "a".repeat(65)],
      ["a path traversal attempt", "../../etc/passwd"],
      ["a path separator inside a valid-looking token", `${"a".repeat(60)}/../x`],
      ["an empty value", ""],
    ])("%s", async (_name, forged) => {
      jar.set(E2E_COOKIE, forged);
      expect(await provider.getSession()).toBeNull();
    });

    // These plant a file holding an ALLOWLISTED email wherever a forged token would point. Without the token-format
    // guard each of them would read that file and sign the forger in as the owner, so a null session here proves the
    // guard (not a missing file) is what rejects them.
    describe("the token-format guard is what stops a forged token from reading a planted file", () => {
      const planted = (path: string) => {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, OWNER);
      };

      it("a path-traversal token that points at a real file outside the state directory", async () => {
        const outside = join(dir, "..", `leaked-${Date.now()}`);
        planted(outside);
        try {
          jar.set(E2E_COOKIE, `../${outside.split("/").pop()}`);
          expect(await provider.getSession()).toBeNull();
        } finally {
          rmSync(outside, { force: true });
        }
      });

      it("an absolute-path token pointing at a real file", async () => {
        const outside = join(tmpdir(), `leaked-abs-${Date.now()}`);
        planted(outside);
        try {
          jar.set(E2E_COOKIE, outside);
          expect(await provider.getSession()).toBeNull();
        } finally {
          rmSync(outside, { force: true });
        }
      });

      it.each([
        ["an upper-case token", "A".repeat(64)],
        ["a token one character too short", "c".repeat(63)],
        ["a token one character too long", "d".repeat(65)],
        ["a token with a non-hex character", `${"e".repeat(63)}g`],
      ])("%s whose file exists inside the state directory", async (_name, forged) => {
        planted(join(dir, forged));
        jar.set(E2E_COOKIE, forged);
        expect(await provider.getSession()).toBeNull();
      });

      it("control: the same planted file IS read for a well-formed token (so the checks above are meaningful)", async () => {
        const valid = "f".repeat(64);
        planted(join(dir, valid));
        jar.set(E2E_COOKIE, valid);
        expect(await provider.getSession()).toEqual({ userId: `e2e-${OWNER}`, email: OWNER });
      });
    });

    it("a minted token with one character changed is rejected", async () => {
      await provider.signInWithPassword(OWNER, env.AUTH_E2E_PASSWORD);
      const token = jar.get(E2E_COOKIE) ?? "";
      jar.set(E2E_COOKIE, `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`);
      expect(await provider.getSession()).toBeNull();
    });

    it("a token whose file holds nothing is rejected", async () => {
      const token = "b".repeat(64);
      writeFileSync(join(dir, token), "   ");
      jar.set(E2E_COOKIE, token);
      expect(await provider.getSession()).toBeNull();
    });
  });

  describe("sign out", () => {
    it("ends the session and removes the cookie", async () => {
      await provider.signInWithPassword(OWNER, env.AUTH_E2E_PASSWORD);
      await provider.signOut();
      expect(jar.has(E2E_COOKIE)).toBe(false);
      expect(await provider.getSession()).toBeNull();
    });

    it("a stale token replayed after sign-out is rejected, because the server forgot it", async () => {
      await provider.signInWithPassword(OWNER, env.AUTH_E2E_PASSWORD);
      const stale = jar.get(E2E_COOKIE) ?? "";
      expect(existsSync(join(dir, stale))).toBe(true);
      await provider.signOut();
      expect(existsSync(join(dir, stale))).toBe(false);
      jar.set(E2E_COOKIE, stale);
      expect(await provider.getSession()).toBeNull();
    });

    it("is safe when signed out or holding a forged value", async () => {
      await expect(provider.signOut()).resolves.toBeUndefined();
      jar.set(E2E_COOKIE, "../../x");
      await expect(provider.signOut()).resolves.toBeUndefined();
      expect(jar.has(E2E_COOKIE)).toBe(false);
    });
  });
});

describe("the e2e account flows", () => {
  const provider = createE2eAuthProvider(env);
  const EMAIL = "newcomer@example.test";
  const hex = (email: string) => Buffer.from(email).toString("hex");
  const inbox = (kind: "verify" | "reset", email = EMAIL) =>
    join(dir, `inbox-${kind}-${hex(email)}`);
  const code = (email = EMAIL) => readFileSync(inbox("verify", email), "utf8").split(":")[0];
  const token = (email = EMAIL) => readFileSync(inbox("reset", email), "utf8");
  const wrongCode = () => (code() === "000000" ? "000001" : "000000");
  const redirectTo = "https://app.example.test/reset-password";

  async function verifiedAccount(password = "my-own-password") {
    await provider.signUp(EMAIL, password);
    await provider.verifyEmail(EMAIL, code());
  }

  it("signs up unverified, mails a code, and says 'unverified' until the code is used", async () => {
    expect(await provider.signUp(EMAIL, "my-own-password")).toEqual({ ok: true });
    expect(code()).toMatch(/^\d{6}$/);
    expect(await provider.signInWithPassword(EMAIL, "my-own-password")).toEqual({
      ok: false,
      unverified: true,
    });
    expect(await provider.signInWithPassword(EMAIL, "wrong-password")).toEqual({ ok: false });
    expect(await provider.verifyEmail(EMAIL, code())).toEqual({ ok: true });
    expect(existsSync(inbox("verify"))).toBe(false);
    expect(await provider.getSession()).toBeNull();
    expect(await provider.signInWithPassword(EMAIL, "my-own-password")).toMatchObject({ ok: true });
    // Their own password only: the shared synthetic one no longer opens this account.
    await provider.signOut();
    expect(await provider.signInWithPassword(EMAIL, env.AUTH_E2E_PASSWORD)).toEqual({ ok: false });
  });

  it("refuses a short password, and a taken address changes nothing and looks like success", async () => {
    expect(await provider.signUp(EMAIL, "short")).toEqual({ ok: false, reason: "weak-password" });
    await verifiedAccount();
    expect(await provider.signUp(EMAIL, "someone-elses-pw")).toEqual({ ok: true });
    expect(existsSync(inbox("verify"))).toBe(false);
    expect(await provider.signInWithPassword(EMAIL, "my-own-password")).toMatchObject({ ok: true });
  });

  it("counts wrong codes, locks after five, and a new code clears the lock", async () => {
    await provider.signUp(EMAIL, "my-own-password");
    for (let i = 0; i < 5; i += 1) {
      expect(await provider.verifyEmail(EMAIL, wrongCode())).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(await provider.verifyEmail(EMAIL, code())).toEqual({ ok: false, reason: "locked" });
    await provider.resendVerificationCode(EMAIL);
    expect(await provider.verifyEmail(EMAIL, code())).toEqual({ ok: true });
    expect(await provider.verifyEmail("nobody@example.test", "123456")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("resends a fresh code only to an unverified account, and reports success either way", async () => {
    expect(await provider.resendVerificationCode("nobody@example.test")).toEqual({ ok: true });
    expect(existsSync(inbox("verify", "nobody@example.test"))).toBe(false);
    await provider.signUp(EMAIL, "my-own-password");
    rmSync(inbox("verify"));
    expect(await provider.resendVerificationCode(EMAIL)).toEqual({ ok: true });
    expect(code()).toMatch(/^\d{6}$/);
  });

  it("resets a password with the emailed token, once, and answers an unknown address the same", async () => {
    await verifiedAccount();
    expect(await provider.requestPasswordReset("nobody@example.test", redirectTo)).toEqual({
      ok: true,
    });
    expect(existsSync(inbox("reset", "nobody@example.test"))).toBe(false);
    expect(await provider.requestPasswordReset(EMAIL, redirectTo)).toEqual({ ok: true });
    const emailed = token();
    expect(await provider.resetPassword(emailed, "short")).toEqual({
      ok: false,
      reason: "weak-password",
    });
    expect(await provider.resetPassword("0".repeat(48), "brand-new-password")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await provider.resetPassword("not a token", "brand-new-password")).toEqual({
      ok: false,
      reason: "invalid",
    });
    // The weak-password try above did not spend the token; this one does.
    expect(await provider.resetPassword(emailed, "brand-new-password")).toEqual({ ok: true });
    expect(await provider.resetPassword(emailed, "another-password-1")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await provider.signInWithPassword(EMAIL, "my-own-password")).toEqual({ ok: false });
    expect(await provider.signInWithPassword(EMAIL, "brand-new-password")).toMatchObject({
      ok: true,
    });
  });
});
