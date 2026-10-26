import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/retention";
import { providerIdentityState } from "./provider-identity";

describe("providerIdentityState", () => {
  it.each([
    [true, "present"],
    [false, "absent"],
  ] as const)("maps the exact-row existence result %s", async (exists, expected) => {
    const execute = vi.fn(async (query: unknown) => {
      expect(query).toBeDefined();
      return { rows: [{ exists }] };
    });
    await expect(
      providerIdentityState({ execute } as unknown as Pick<Db, "execute">, "synthetic-user", 1),
    ).resolves.toBe(expected);
    const query = execute.mock.calls[0][0];
    expect(JSON.stringify(query)).not.toContain("example.test");
  });

  it("supports array-shaped driver results without selecting identity fields", async () => {
    const execute = vi.fn(async (query: unknown) => {
      expect(query).toBeDefined();
      return [{ exists: false }];
    });
    await expect(
      providerIdentityState({ execute } as unknown as Pick<Db, "execute">, "synthetic-user", 1),
    ).resolves.toBe("absent");
  });

  it.each([
    ["a malformed response", async () => ({ rows: [{}] })],
    ["a permission failure", async () => Promise.reject(new Error("permission denied"))],
  ])("fails closed for %s", async (_name, answer) => {
    await expect(
      providerIdentityState(
        { execute: answer } as unknown as Pick<Db, "execute">,
        "synthetic-user",
        1,
      ),
    ).resolves.toBe("unavailable");
  });

  it("rejects invalid identity input before querying", async () => {
    const execute = vi.fn();
    await expect(
      providerIdentityState({ execute } as unknown as Pick<Db, "execute">, "", Number.NaN),
    ).resolves.toBe("unavailable");
    expect(execute).not.toHaveBeenCalled();
  });
});
