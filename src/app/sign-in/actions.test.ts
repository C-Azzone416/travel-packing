import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { createMemorySetupStore } from "@/server/auth/account-setup";
import { parseAllowlist } from "@/server/auth/allowlist";
import { createSetupSeals } from "@/server/auth/setup-seal";

const fake = createFakeAuth([
  { email: "owner@example.test", password: "pw-owner", userId: "u1" },
  { email: "pending@example.test", password: "pw-pending", userId: "u3", verified: false },
  { email: "waiting@example.test", password: "pw-waiting", userId: "u4", verified: false },
  { email: "owner2@example.test", password: "pw-owner2", userId: "u5", unfinished: true },
  { email: "intruder@example.test", password: "pw-intruder", userId: "u2" },
  { email: "second@example.test", password: "pw-second", userId: "u6" },
]);
let available = true;

vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist(
      "owner@example.test, waiting@example.test, owner2@example.test, second@example.test",
    ),
    seals: createSetupSeals("s".repeat(40)),
    setup: createMemorySetupStore(),
    available,
  }),
}));
let forwardedFor: string | null = "203.0.113.7";
let hostHeader: string | null = "app.example.test";
const jar = new Map<string, string>();
let failAnonymousWrite = false;
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(hostHeader ? { host: hostHeader } : {}),
    }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      if (failAnonymousWrite && name === "anon-appearance") throw new Error("cookie write failed");
      jar.set(name, value);
    },
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const saved = vi.hoisted(() => new Map<string, string>());
vi.mock("@/features/settings/saved-appearance", () => ({
  readAppearanceForUser: async (userId: string) => {
    if (userId === "throws") throw new Error("db down");
    return saved.get(userId);
  },
}));

import { signInAction, signOutAction } from "./actions";
import { resetFlowLimits } from "@/server/auth/flow-limits";
import { resetSignInLimits } from "@/server/auth/sign-in-limit";
import { setAuthLogSink } from "@/server/auth/safe-log";
import {
  INVALID_CREDENTIALS_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  type SignInState,
} from "./state";

const form = (email: string, password: string) => {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
};
const failure = (error: string) => ({
  error,
  reference: expect.stringMatching(/^[0-9a-f]{12}$/),
});

beforeEach(() => {
  jar.clear();
  resetFlowLimits();
  fake.current = null;
  available = true;
  forwardedFor = "203.0.113.7";
  hostHeader = "app.example.test";
  resetSignInLimits();
  setAuthLogSink(() => {});
});

describe("signInAction before the password was set through a link (#83)", () => {
  it("gives no session: it sends the setup link, remembers the address, and says 'check your email'", async () => {
    fake.flows.calls.length = 0;
    await expect(
      signInAction({ error: null }, form("owner2@example.test", "pw-owner2")),
    ).rejects.toThrow("NEXT_REDIRECT:/finish-setup");
    expect(fake.current).toBeNull();
    expect(jar.get("cw-pending-email")).toBe("owner2@example.test");
    expect(fake.flows.calls).toHaveLength(1);
    expect(fake.flows.calls[0].method).toBe("requestPasswordReset");
    const [email, link] = fake.flows.calls[0].args as string[];
    expect(email).toBe("owner2@example.test");
    // The setup variant of the link, naming the address it is for.
    const url = new URL(link);
    expect(url.searchParams.get("setup")).toBe("1");
    expect(url.searchParams.get("for")).toBeTruthy();
  });

  it("is not counted as a failed attempt (the password was right)", async () => {
    for (let i = 0; i < 9; i += 1) {
      expect(await signInAction({ error: null }, form("owner2@example.test", "wrong"))).toEqual(
        failure(INVALID_CREDENTIALS_MESSAGE),
      );
    }
    await expect(
      signInAction({ error: null }, form("owner2@example.test", "pw-owner2")),
    ).rejects.toThrow("NEXT_REDIRECT:/finish-setup");
    for (let i = 0; i < 9; i += 1) {
      expect(await signInAction({ error: null }, form("owner2@example.test", "wrong"))).toEqual(
        failure(INVALID_CREDENTIALS_MESSAGE),
      );
    }
  });

  it("still goes to 'check your email' when the host cannot be worked out, sending nothing", async () => {
    hostHeader = null;
    fake.flows.calls.length = 0;
    await expect(
      signInAction({ error: null }, form("owner2@example.test", "pw-owner2")),
    ).rejects.toThrow("NEXT_REDIRECT:/finish-setup");
    expect(fake.flows.calls).toEqual([]);
  });

  it("holds a repeat inside the 30-second gap without sending another link", async () => {
    fake.flows.calls.length = 0;
    for (let i = 0; i < 2; i += 1) {
      await expect(
        signInAction({ error: null }, form("owner2@example.test", "pw-owner2")),
      ).rejects.toThrow("NEXT_REDIRECT:/finish-setup");
    }
    expect(fake.flows.calls).toHaveLength(1);
  });
});

describe("signInAction with an unverified account", () => {
  // This is the recovery path for an expired or lost code: the person proves the password and gets a fresh code.
  it("sends a fresh code to an allowlisted address, remembers it, and goes to the code screen", async () => {
    fake.flows.calls.length = 0;
    await expect(
      signInAction({ error: null }, form(" Waiting@Example.test ".toLowerCase(), "pw-waiting")),
    ).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(fake.flows.calls).toEqual([
      { method: "resendVerificationCode", args: ["waiting@example.test"] },
    ]);
    expect(jar.get("cw-pending-email")).toBe("waiting@example.test");
    expect(fake.current).toBeNull();
  });

  it("sends nothing for an address that is not on the allowlist, but behaves the same on screen", async () => {
    fake.flows.calls.length = 0;
    await expect(
      signInAction({ error: null }, form("pending@example.test", "pw-pending")),
    ).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(fake.flows.calls).toEqual([]);
  });

  it("holds a second request inside the 30-second gap without sending another code", async () => {
    fake.flows.calls.length = 0;
    for (let i = 0; i < 2; i += 1) {
      await expect(
        signInAction({ error: null }, form("waiting@example.test", "pw-waiting")),
      ).rejects.toThrow("NEXT_REDIRECT:/verify");
    }
    expect(fake.flows.calls).toHaveLength(1);
  });

  it("clears the failed-attempt count for the pair, because the password was right", async () => {
    for (let i = 0; i < 9; i += 1) {
      expect(await signInAction({ error: null }, form("waiting@example.test", "wrong"))).toEqual(
        failure(INVALID_CREDENTIALS_MESSAGE),
      );
    }
    await expect(
      signInAction({ error: null }, form("waiting@example.test", "pw-waiting")),
    ).rejects.toThrow("NEXT_REDIRECT:/verify");
    // Nine more wrong passwords would have tripped the limit of ten had the count not been cleared.
    for (let i = 0; i < 9; i += 1) {
      expect(await signInAction({ error: null }, form("waiting@example.test", "wrong"))).toEqual(
        failure(INVALID_CREDENTIALS_MESSAGE),
      );
    }
  });

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
    expect(await signInAction({ error: null }, form("pending@example.test", "wrong"))).toEqual(
      failure(INVALID_CREDENTIALS_MESSAGE),
    );
    expect(jar.size).toBe(0);
  });
});

describe("the remembered address after sign-in and sign-out (#209)", () => {
  it("is forgotten by a successful sign-in, so the next visitor to the code screens does not see it", async () => {
    jar.set("cw-pending-email", "previous@example.test");
    await expect(
      signInAction({ error: null }, form("owner@example.test", "pw-owner")),
    ).rejects.toThrow("NEXT_REDIRECT:/");
    expect(jar.has("cw-pending-email")).toBe(false);
  });

  it.each([
    ["a wrong password", form("owner@example.test", "wrong")],
    ["a non-allowlisted account", form("intruder@example.test", "pw-intruder")],
  ])("is kept after %s: the minimum state a recovery needs", async (_name, data) => {
    jar.set("cw-pending-email", "previous@example.test");
    await signInAction({ error: null }, data).catch(() => undefined);
    expect(jar.get("cw-pending-email")).toBe("previous@example.test");
  });

  it("is forgotten by sign-out", async () => {
    jar.set("cw-pending-email", "previous@example.test");
    fake.current = { userId: "u1", email: "owner@example.test" };
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(jar.has("cw-pending-email")).toBe(false);
  });
});

describe("signInAction", () => {
  it("routes a correctly authenticated fenced identity to account-closure recovery", async () => {
    vi.spyOn(fake, "signInWithPassword").mockResolvedValueOnce({
      ok: false,
      deletionPending: true,
      diagnostic: { reason: "account-deletion-pending" },
    });
    await expect(
      signInAction({ error: null }, form("owner@example.test", "pw-owner")),
    ).rejects.toThrow("NEXT_REDIRECT:/close-account");
  });

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
    expect(await signInAction({ error: null }, data)).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    expect(fake.current).toBeNull();
  });

  it.each([
    ["provider unavailable", "provider-unavailable"],
    ["provider rate limited", "provider-rate-limited"],
    ["session not created", "session-not-created"],
    ["invalid provider response", "provider-response-invalid"],
  ] as const)("keeps %s details out of the action response", async (_name, reason) => {
    vi.spyOn(fake, "signInWithPassword").mockResolvedValueOnce({
      ok: false,
      diagnostic: { reason },
    });

    const result = await signInAction(
      { error: null },
      form("owner@example.test", "not-the-password"),
    );
    expect(result).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    expect(Object.keys(result).sort()).toEqual(["error", "reference"]);
  });

  it("gives repeated failures for the same address different references", async () => {
    const first = await signInAction(
      { error: null },
      form("owner@example.test", "not-the-password"),
    );
    const second = await signInAction(
      { error: null },
      form("owner@example.test", "not-the-password"),
    );

    expect(first).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    expect(second).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    expect(first.reference).not.toBe(second.reference);
  });

  it("says sign-in is unavailable when auth is not configured, without trying to sign in", async () => {
    available = false;
    expect(await signInAction({ error: null }, form("owner@example.test", "pw-owner"))).toEqual(
      failure(UNAVAILABLE_MESSAGE),
    );
    expect(fake.current).toBeNull();
  });
});

describe("signOutAction", () => {
  it("ends the session and redirects to sign-in", async () => {
    fake.current = { userId: "u1", email: "owner@example.test" };
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(fake.current).toBeNull();
  });

  it("clears the account mirror so it does not outlive the session, but keeps only its palette id as the anonymous cookie (#283)", async () => {
    jar.set("appearance", "ocean");
    jar.set("cw-pending-email", "previous@example.test");
    fake.current = { userId: "u1", email: "owner@example.test" };
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(fake.current).toBeNull();
    expect(jar.has("appearance")).toBe(false);
    expect(jar.has("cw-pending-email")).toBe(false);
    expect([...jar.entries()]).toEqual([["anon-appearance", "ocean"]]);
  });

  it("still deletes the mirror and the pending email, and still redirects, when the anonymous copy throws (#289)", async () => {
    jar.set("appearance", "ocean");
    jar.set("cw-pending-email", "previous@example.test");
    jar.set("anon-appearance", "violet");
    fake.current = { userId: "u1", email: "owner@example.test" };
    failAnonymousWrite = true;
    try {
      await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    } finally {
      failAnonymousWrite = false;
    }
    expect(fake.current).toBeNull();
    expect(jar.has("appearance")).toBe(false);
    expect(jar.has("cw-pending-email")).toBe(false);
    expect([...jar.entries()]).toEqual([["anon-appearance", "violet"]]);
  });

  it("keeps the existing anonymous cookie when there is no mirror, and never stores an invalid mirror", async () => {
    jar.set("anon-appearance", "violet");
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(jar.get("anon-appearance")).toBe("violet");
    jar.set("appearance", "neon");
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(jar.get("anon-appearance")).toBe("violet");
    expect(jar.has("appearance")).toBe(false);
  });
});

describe("the anonymous palette cookie across sign-in (#283)", () => {
  beforeEach(() => saved.clear());
  const signIn = (email: string, password: string) =>
    expect(signInAction({ error: null }, form(email, password))).rejects.toThrow("NEXT_REDIRECT:/");

  it("each account's saved palette refreshes the anonymous cookie: A then B", async () => {
    saved.set("u1", "terracotta");
    saved.set("u6", "violet");
    await signIn("owner@example.test", "pw-owner");
    expect(jar.get("anon-appearance")).toBe("terracotta");
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(jar.get("anon-appearance")).toBe("terracotta");
    await signIn("second@example.test", "pw-second");
    expect(jar.get("anon-appearance")).toBe("violet");
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(jar.get("anon-appearance")).toBe("violet");
  });

  it("the anonymous value never reaches the account: sign-in only reads the account", async () => {
    jar.set("anon-appearance", "ocean");
    await signIn("owner@example.test", "pw-owner");
    // Nothing saved for the account: the cookie is left alone and nothing is written anywhere.
    expect(jar.get("anon-appearance")).toBe("ocean");
    expect([...saved.entries()]).toEqual([]);
  });

  it("a failed read of the saved palette never fails the sign-in", async () => {
    vi.spyOn(fake, "signInWithPassword").mockResolvedValueOnce({
      ok: true,
      session: { userId: "throws", email: "owner@example.test" },
    });
    await signIn("owner@example.test", "pw-owner");
    expect(jar.has("anon-appearance")).toBe(false);
  });

  it("a failed or denied sign-in leaves the anonymous cookie alone", async () => {
    saved.set("u2", "violet");
    jar.set("anon-appearance", "ocean");
    await expect(
      signInAction({ error: null }, form("intruder@example.test", "pw-intruder")),
    ).rejects.toThrow("NEXT_REDIRECT:/access-denied");
    await signInAction({ error: null }, form("owner@example.test", "wrong"));
    expect(jar.get("anon-appearance")).toBe("ocean");
  });

  it("the cookie value is only ever a palette id", async () => {
    saved.set("u1", "violet");
    await signIn("owner@example.test", "pw-owner");
    expect(jar.get("anon-appearance")).toMatch(/^(base|ocean|terracotta|violet)$/);
    expect([...jar.values()].join(" ")).not.toMatch(/owner|u1|@/);
  });
});

describe("signInAction rate limit", () => {
  const wrong = (email = "owner@example.test") =>
    signInAction({ error: null }, form(email, "wrong"));
  const right = () => signInAction({ error: null }, form("owner@example.test", "pw-owner"));

  it("blocks guessing at one account from one address after 10 failures, before looking at the credentials", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await wrong()).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    }
    expect(await wrong()).toEqual(failure(RATE_LIMITED_MESSAGE));
    // Even the right password is refused while blocked, and it does not sign in.
    expect(await right()).toEqual(failure(RATE_LIMITED_MESSAGE));
    expect(fake.current).toBeNull();
  });

  it("someone elsewhere cannot lock the owner out: ten failures from another address leave the owner free", async () => {
    forwardedFor = "198.51.100.66";
    for (let attempt = 0; attempt < 10; attempt += 1) await wrong();
    expect(await wrong()).toEqual(failure(RATE_LIMITED_MESSAGE));
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
    ).toEqual(failure(RATE_LIMITED_MESSAGE));
  });

  it("counts the email without regard to case or spaces", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1)
      await wrong(attempt % 2 ? "OWNER@example.test " : "owner@example.test");
    expect(await wrong(" Owner@Example.test")).toEqual(failure(RATE_LIMITED_MESSAGE));
  });

  it("leaves other accounts alone until the address itself passes its larger allowance", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await wrong();
    expect(await wrong("nobody@example.test")).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
    for (let attempt = 0; attempt < 40; attempt += 1) await wrong(`user${attempt}@example.test`);
    expect(await wrong("fresh@example.test")).toEqual(failure(RATE_LIMITED_MESSAGE));
    forwardedFor = "198.51.100.9";
    expect(await wrong("fresh@example.test")).toEqual(failure(INVALID_CREDENTIALS_MESSAGE));
  });

  it("logs only a closed event code when it blocks (no email, no address)", async () => {
    const lines: string[] = [];
    setAuthLogSink((line) => lines.push(line));
    let response: SignInState = { error: null };
    for (let attempt = 0; attempt < 11; attempt += 1) response = await wrong();
    const limited = lines.filter((line) => line.includes("sign-in-rate-limited"));
    expect(limited).toHaveLength(1);
    expect(JSON.parse(limited[0]).reference).toBe(response.reference);
    expect(limited[0]).not.toContain("owner@");
    expect(limited[0]).not.toContain("203.0.113.7");
  });

  it("still limits a caller with no usable address header (one shared bucket)", async () => {
    forwardedFor = null;
    for (let attempt = 0; attempt < 40; attempt += 1) await wrong(`user${attempt}@example.test`);
    expect(await wrong("fresh@example.test")).toEqual(failure(RATE_LIMITED_MESSAGE));
  });
});
