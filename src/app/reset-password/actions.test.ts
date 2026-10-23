import { beforeEach, describe, expect, it, vi } from "vitest";

// #209: finishing setup (or a reset) ends the remembered-address state; a failed attempt keeps it for recovery.
const jar = new Map<string, string>([["cw-pending-email", "previous@example.test"]]);
vi.mock("next/headers", () => ({
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
let outcome: { status: string; problem?: string } = { status: "ok" };
vi.mock("@/server/auth/account-flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/account-flows")>()),
  resetOwnerPassword: async () => outcome,
}));
vi.mock("@/features/auth/server", () => ({
  accountContext: async () => ({ auth: { available: true } }),
  field: (data: FormData, name: string) => String(data.get(name) ?? ""),
}));

import { resetAction } from "./actions";

const form = (variant = "setup") => {
  const data = new FormData();
  data.set("token", "t");
  data.set("password", "a-good-password-1");
  data.set("variant", variant);
  return data;
};
const previous = { error: null, fieldErrors: {}, email: "" };

beforeEach(() => {
  jar.set("cw-pending-email", "previous@example.test");
  outcome = { status: "ok" };
});

describe("resetAction and the remembered address", () => {
  it.each([
    ["setup", "password-set"],
    ["reset", "password-updated"],
  ])("a finished %s forgets it and goes to sign-in", async (variant, notice) => {
    await expect(resetAction(previous, form(variant))).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?notice=${notice}`,
    );
    expect(jar.has("cw-pending-email")).toBe(false);
  });

  it.each([
    ["a link that no longer works", { status: "invalid-link" }],
    ["a weak password", { status: "weak-password", problem: "short" }],
    ["too many tries", { status: "rate-limited" }],
    ["an unavailable provider", { status: "unavailable" }],
  ])("keeps it after %s", async (_name, result) => {
    outcome = result;
    await resetAction(previous, form()).catch(() => undefined);
    expect(jar.get("cw-pending-email")).toBe("previous@example.test");
  });
});
