import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";

const fake = createFakeAuth([
  { email: "owner@example.test", password: "pw-owner", userId: "u1" },
  { email: "pending@example.test", password: "pw-pending", userId: "u3", verified: false },
  { email: "intruder@example.test", password: "pw-intruder", userId: "u2" },
]);
let available = true;

vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist("owner@example.test"),
    available,
  }),
}));
let forwardedFor: string | null = "203.0.113.7";
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { signInAction, signOutAction } from "./actions";
import { resetFlowLimits } from "@/server/auth/flow-limits";
import { resetSignInLimits } from "@/server/auth/sign-in-limit";
import { setAuthLogSink } from "@/server/auth/safe-log";
import { INVALID_CREDENTIALS_MESSAGE, RATE_LIMITED_MESSAGE, UNAVAILABLE_MESSAGE } from "./state";

const form = (email: string, password: string) => {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
};

beforeEach(() => {
  jar.clear();
  resetFlowLimits();
  fake.current = null;
  available = true;
  forwardedFor = "203.0.113.7";
  resetSignInLimits();
  setAuthLogSink(() => {});
});

describe("signInAction with an unverified account", () => {
  it("sends the person to the code screen with a new code, remembering the address", async () => {
    await expect(
      signInAction({ error: null }, form("  pending@example.test ", "pw-pending")),
    ).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(fake.current).toBeNull();
    expect(jar.get("cw-pending-email")).toBe("pending@example.test");
  });

  it("is not counted as a failed attempt (the password was right)", async () => {
    for (let i = 0; i < 12; i += 1) {
      await expect(
        signInAction({ error: null }, form("pending@example.test", "pw-pending")),
      ).rejects.toThrow("NEXT_REDIRECT:/verify");
    }
    await expect(
      signInAction({ error: null }, form("owner@example.test", "pw-owner")),
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("still gives the generic error for a wrong password on the same account", async () => {
    expect(await signInAction({ error: null }, form("pending@example.test", "wrong"))).toEqual({
      error: INVALID_CREDENTIALS_MESSAGE,
    });
    expect(jar.size).toBe(0);
  });
});

describe("signInAction", () => {
  it("redirects an allowlisted owner to the app", async () => {
    await expect(
      signInAction({ error: null }, form("owner@example.test", "pw-owner")),
    ).rejects.toThrow("NEXT_REDIRECT:/");
    expect(fake.current).toMatchObject({ email: "owner@example.test" });
  });

  it("sends a non-allowlisted account to access-denied with the session already ended", async () => {
    await expect(
      signInAction({ error: null }, form("intruder@example.test", "pw-intruder")),
    ).rejects.toThrow("NEXT_REDIRECT:/access-denied");
    expect(fake.current).toBeNull();
  });

  it.each([
    ["a wrong password", form("owner@example.test", "wrong")],
    ["an unknown email", form("nobody@example.test", "pw-owner")],
    ["empty fields", new FormData()],
  ])("returns one generic error for %s", async (_name, data) => {
    expect(await signInAction({ error: null }, data)).toEqual({
      error: INVALID_CREDENTIALS_MESSAGE,
    });
    expect(fake.current).toBeNull();
  });

  it("says sign-in is unavailable when auth is not configured, without trying to sign in", async () => {
    available = false;
    expect(await signInAction({ error: null }, form("owner@example.test", "pw-owner"))).toEqual({
      error: UNAVAILABLE_MESSAGE,
    });
    expect(fake.current).toBeNull();
  });
});

describe("signOutAction", () => {
  it("ends the session and redirects to sign-in", async () => {
    fake.current = { userId: "u1", email: "owner@example.test" };
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(fake.current).toBeNull();
  });
});

describe("signInAction rate limit", () => {
  const wrong = (email = "owner@example.test") =>
    signInAction({ error: null }, form(email, "wrong"));
  const right = () => signInAction({ error: null }, form("owner@example.test", "pw-owner"));

  it("blocks guessing at one account from one address after 10 failures, before looking at the credentials", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await wrong()).toEqual({ error: INVALID_CREDENTIALS_MESSAGE });
    }
    expect(await wrong()).toEqual({ error: RATE_LIMITED_MESSAGE });
    // Even the right password is refused while blocked, and it does not sign in.
    expect(await right()).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(fake.current).toBeNull();
  });

  it("someone elsewhere cannot lock the owner out: ten failures from another address leave the owner free", async () => {
    forwardedFor = "198.51.100.66";
    for (let attempt = 0; attempt < 10; attempt += 1) await wrong();
    expect(await wrong()).toEqual({ error: RATE_LIMITED_MESSAGE });
    forwardedFor = "203.0.113.7";
    await expect(right()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(fake.current).toMatchObject({ email: "owner@example.test" });
  });

  it("successful sign-ins never count, and a success clears the pair's failures", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(right()).rejects.toThrow("NEXT_REDIRECT:/");
      fake.current = null;
    }
    for (let attempt = 0; attempt < 9; attempt += 1) await wrong();
    await expect(right()).rejects.toThrow("NEXT_REDIRECT:/");
    fake.current = null;
    for (let attempt = 0; attempt < 9; attempt += 1) await wrong();
    await expect(right()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("counts a valid but not allowed-in account as a failure too", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        signInAction({ error: null }, form("intruder@example.test", "pw-intruder")),
      ).rejects.toThrow("NEXT_REDIRECT:/access-denied");
    }
    expect(
      await signInAction({ error: null }, form("intruder@example.test", "pw-intruder")),
    ).toEqual({ error: RATE_LIMITED_MESSAGE });
  });

  it("counts the email without regard to case or spaces", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1)
      await wrong(attempt % 2 ? "OWNER@example.test " : "owner@example.test");
    expect(await wrong(" Owner@Example.test")).toEqual({ error: RATE_LIMITED_MESSAGE });
  });

  it("leaves other accounts alone until the address itself passes its larger allowance", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await wrong();
    expect(await wrong("nobody@example.test")).toEqual({ error: INVALID_CREDENTIALS_MESSAGE });
    for (let attempt = 0; attempt < 40; attempt += 1) await wrong(`user${attempt}@example.test`);
    expect(await wrong("fresh@example.test")).toEqual({ error: RATE_LIMITED_MESSAGE });
    forwardedFor = "198.51.100.9";
    expect(await wrong("fresh@example.test")).toEqual({ error: INVALID_CREDENTIALS_MESSAGE });
  });

  it("logs only a closed event code when it blocks (no email, no address)", async () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    for (let attempt = 0; attempt < 11; attempt += 1) await wrong();
    const limited = lines.filter((line) => line.includes("sign-in-rate-limited"));
    expect(limited).toHaveLength(1);
    expect(limited[0]).not.toContain("owner@");
    expect(limited[0]).not.toContain("203.0.113.7");
  });

  it("still limits a caller with no usable address header (one shared bucket)", async () => {
    forwardedFor = null;
    for (let attempt = 0; attempt < 40; attempt += 1) await wrong(`user${attempt}@example.test`);
    expect(await wrong("fresh@example.test")).toEqual({ error: RATE_LIMITED_MESSAGE });
  });
});
