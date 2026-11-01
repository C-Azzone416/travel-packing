import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/retention";
import { lockAccountDeletion, lockAccountSetup } from "./account-deletion-lock";

describe("advisory lock SQL", () => {
  it.each([
    ["owner", lockAccountDeletion, "synthetic-owner", "1742457091"],
    ["setup", lockAccountSetup, "a".repeat(64), "1742457092"],
  ] as const)(
    "takes the transaction-scoped %s lock with its namespace and key",
    async (_name, lock, key, namespace) => {
      const queries: unknown[] = [];
      const execute = vi.fn(async (query: unknown) => {
        queries.push(query);
        return [];
      });
      await lock({ execute } as unknown as Pick<Db, "execute">, key);

      expect(execute).toHaveBeenCalledOnce();
      const serialized = JSON.stringify(queries[0]);
      expect(serialized).toContain("pg_advisory_xact_lock");
      expect(serialized).toContain("hashtext");
      expect(serialized).toContain(namespace);
      expect(serialized).toContain(key);
    },
  );
});
