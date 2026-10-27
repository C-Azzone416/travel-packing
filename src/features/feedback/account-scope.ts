// Which browser databases belong to which account (#260). The on-device outbox is one IndexedDB per account, named from the opaque
// `outboxKey` the server derived from the account and its generation (never the email or owner id). So an account only ever opens
// its own database: another account on the same browser cannot see, resume or send its notes and screenshots. On top of that:
//   - when an account's page loads, every OTHER account's database is deleted (an account switch clears the previous account's
//     unsent feedback), and
//   - sign-out deletes the signed-out account's own database before the session ends.
// The databases the #137 version made (its refresh credential and an outbox with no owner) are deleted once, on first load.
// All of it is best effort and never throws: a browser without `indexedDB.databases()` can still scope, just not sweep.
// feedback-account-scope

export const ACCOUNT_SCOPE_PREFIX = "acct-";
/** The SDK names a queue's database `framebriar-v1-<scope>`. */
export const ACCOUNT_DB_PREFIX = `framebriar-v1-${ACCOUNT_SCOPE_PREFIX}`;
/** What #137 left behind: the browser-held enrollment (a refresh credential) and an outbox named by endpoint, not by account. */
export const LEGACY_DB_PREFIXES = ["framebriar-enrollment-", "framebriar-v1-outbox-"] as const;

const OUTBOX_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** The queue scope for an account's outbox. Throws for anything that is not the server's opaque key, so a name can never be forged. */
export function accountScope(outboxKey: string): string {
  if (!OUTBOX_KEY.test(outboxKey)) throw new Error("Not an outbox key");
  return `${ACCOUNT_SCOPE_PREFIX}${outboxKey}`;
}

export const accountDatabaseName = (outboxKey: string) =>
  `framebriar-v1-${accountScope(outboxKey)}`;

type Factory = Pick<IDBFactory, "deleteDatabase"> & Partial<Pick<IDBFactory, "databases">>;

const DELETE_WAIT_MS = 3000;

/** Deletes one database. Resolves true when it is gone, false when it could not be (blocked by another tab, error). */
function deleteDatabase(factory: Factory, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // A connection still open in another tab blocks the delete until it closes; the delete then completes by itself.
    const timer = setTimeout(() => finish(false), DELETE_WAIT_MS);
    try {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => finish(true);
      request.onerror = () => finish(false);
      request.onblocked = () => undefined;
    } catch {
      finish(false);
    }
  });
}

/** Every database name this browser has, or null when the browser cannot list them. */
async function databaseNames(factory: Factory): Promise<string[] | null> {
  if (typeof factory.databases !== "function") return null;
  try {
    const list = await factory.databases();
    return list
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string");
  } catch {
    return null;
  }
}

export interface Sweep {
  /** Whether the browser could list its databases (so whether the sweep could look). */
  listed: boolean;
  deleted: number;
  failed: number;
}

async function deleteMatching(factory: Factory, keep: (name: string) => boolean): Promise<Sweep> {
  const names = await databaseNames(factory);
  if (names === null) return { listed: false, deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  for (const name of names.filter(keep)) {
    if (await deleteDatabase(factory, name)) deleted += 1;
    else failed += 1;
  }
  return { listed: true, deleted, failed };
}

/** An account switch: delete every account's outbox except `keepKey`'s. */
export function sweepOtherAccounts(factory: Factory, keepKey: string): Promise<Sweep> {
  const keep = accountDatabaseName(keepKey);
  return deleteMatching(factory, (name) => name.startsWith(ACCOUNT_DB_PREFIX) && name !== keep);
}

/** Sign-out: delete this account's own outbox. */
export async function deleteAccountOutbox(factory: Factory, outboxKey: string): Promise<boolean> {
  return deleteDatabase(factory, accountDatabaseName(outboxKey));
}

/** Delete the #137 enrollment (a refresh credential) and its owner-less outbox. Safe to repeat: with none left it does nothing. */
export function deleteLegacyDatabases(factory: Factory): Promise<Sweep> {
  return deleteMatching(factory, (name) =>
    LEGACY_DB_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
}
