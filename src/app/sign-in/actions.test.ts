import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";

const fake = createFakeAuth([
  { email: "owner@example.test", password: "pw-owner", userId: "u1" },
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
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { signInAction, signOutAction } from "./actions";
import { INVALID_CREDENTIALS_MESSAGE, UNAVAILABLE_MESSAGE } from "./state";

const form = (email: string, password: string) => {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
};

beforeEach(() => {
  fake.current = null;
  available = true;
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
