// The single gate every data-layer entry point goes through:
//   1. authorize (allowlisted owner) -> owner id comes from the session, NEVER from client input
//   2. validate input with zod
//   3. run the handler, scoped to that owner
//   4. map failures to a typed Result (no stack traces, no data, no database text)

import { eq } from "drizzle-orm";
import { ZodError, type ZodType } from "zod";
import { authorizeOwner } from "../auth/guard";
import { createRateLimiter, type RateLimiter } from "../locations/rate-limit";
import type { DataContext } from "./context";
import { lockAccountDeletion } from "../auth/account-deletion-lock";
import { fail, ok, type Result } from "./result";
import { logDataEvent } from "./safe-log";
import * as schema from "../db/schema";
import type { Db } from "../db/retention";

/** A handler can refuse with a typed error instead of throwing. */
export class Refusal extends Error {
  constructor(readonly result: Result<never>) {
    super("refused");
    this.name = "Refusal";
  }
}

export function refuse(result: Result<never>): never {
  throw new Refusal(result);
}

export interface OwnerScope {
  db: Db;
  ownerId: string;
}

/**
 * A guard rail on every data-layer call (reads and writes), per signed-in owner (#22): 300 a minute, far above normal
 * use, so a runaway client or script cannot hammer the database. State is per server instance (memory); a shared
 * limit across instances is Caroline's call (#28).
 */
export const DATA_CALLS_PER_MINUTE = 300;

/**
 * Calls a minute per owner from DATA_CALLS_PER_MINUTE: a whole number from 1 to 100000. Anything else (unset, blank,
 * fractional, zero, text) uses the default, so a bad value never switches the limit off. The browser tests raise it
 * because one owner drives a whole suite through a fast run.
 */
export function dataCallsPerMinute(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATA_CALLS_PER_MINUTE?.trim() ?? "";
  if (!/^\d{1,6}$/.test(raw)) return DATA_CALLS_PER_MINUTE;
  const value = Number(raw);
  return value >= 1 && value <= 100_000 ? value : DATA_CALLS_PER_MINUTE;
}

const defaultLimiter = (): RateLimiter =>
  createRateLimiter({ limit: dataCallsPerMinute(), windowMs: 60_000 });
let limiter = defaultLimiter();

/** Test hook: swap the limiter (for example one with an injected clock). Call with no argument to reset it. */
export function setDataRateLimiter(next?: RateLimiter): void {
  limiter = next ?? defaultLimiter();
}

/**
 * Run one owner operation while holding the identity advisory lock. The handler must stay inside this transaction: if the
 * lock were released first, an old request could pause, deletion could finish, the provider could reuse the id, and the old
 * handler could resume against the replacement identity's rows.
 */
async function runForOwner<Output>(
  db: Db,
  ownerId: string,
  stillAuthorized: () => Promise<boolean>,
  handler: (scope: OwnerScope) => Promise<Output>,
): Promise<{ authorized: false } | { authorized: true; data: Output }> {
  return db.transaction(async (transaction) => {
    // Deletion takes the same lock before inserting its fence. If it started first, this transaction waits for the
    // commit and then sees the fence; if provisioning started first, deletion runs after this transaction and removes
    // the owner plus any writes that could have raced it.
    await lockAccountDeletion(transaction, ownerId);
    // The first session read happened before this lock. If provider deletion completed while this request waited, only a
    // fresh authoritative read here can prevent the now-stale request from recreating the owner after the fence is cleared.
    if (!(await stillAuthorized())) return { authorized: false as const };
    const fence = await transaction
      .select({ userId: schema.accountDeletions.userId })
      .from(schema.accountDeletions)
      .where(eq(schema.accountDeletions.userId, ownerId))
      .limit(1);
    if (fence.length > 0) return { authorized: false as const };

    await transaction.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();
    const rows = await transaction
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, ownerId))
      .limit(1);
    if (rows.length !== 1) return { authorized: false as const };
    return {
      authorized: true as const,
      data: await handler({ db: transaction as unknown as Db, ownerId }),
    };
  });
}

export async function run<Input, Output>(
  context: DataContext,
  inputSchema: ZodType<Input>,
  rawInput: unknown,
  handler: (scope: OwnerScope, input: Input) => Promise<Output>,
): Promise<Result<Output>> {
  const decision = await authorizeOwner(context.auth.provider, context.auth.allowlist);
  if (decision.status !== "ok") {
    const code = decision.status === "unauthenticated" ? "UNAUTHENTICATED" : "FORBIDDEN";
    logDataEvent(`error:${code}`);
    return fail(code);
  }

  if (!limiter.consume(decision.session.userId).ok) {
    logDataEvent("error:UNAVAILABLE");
    return fail("UNAVAILABLE", { reason: "RATE_LIMITED" });
  }

  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    logDataEvent("error:INVALID_INPUT");
    return fail("INVALID_INPUT", { fields: fieldPaths(parsed.error) });
  }

  try {
    const execution = await runForOwner(
      context.db,
      decision.session.userId,
      async () => {
        const current = await authorizeOwner(
          context.auth.deletionProvider ?? context.auth.provider,
          context.auth.allowlist,
        );
        return (
          current.status === "ok" &&
          current.session.userId === decision.session.userId &&
          current.session.identityCreatedAt !== undefined &&
          current.session.identityCreatedAt === decision.session.identityCreatedAt
        );
      },
      (scope) => handler(scope, parsed.data),
    );
    if (!execution.authorized) refuse(fail("UNAUTHENTICATED"));
    return ok(execution.data);
  } catch (error) {
    if (error instanceof Refusal) {
      logDataEvent(`error:${error.result.ok ? "INTERNAL" : error.result.error.code}`);
      return error.result;
    }
    logDataEvent("error:INTERNAL");
    return fail("INTERNAL");
  }
}

function fieldPaths(error: ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.join(".") || "(root)"))];
}
