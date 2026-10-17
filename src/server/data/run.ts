// The single gate every data-layer entry point goes through:
//   1. authorize (allowlisted owner) -> owner id comes from the session, NEVER from client input
//   2. validate input with zod
//   3. run the handler, scoped to that owner
//   4. map failures to a typed Result (no stack traces, no data, no database text)

import { ZodError, type ZodType } from "zod";
import { authorizeOwner } from "../auth/guard";
import type { DataContext } from "./context";
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

/** The app-side owner row every other row references. Safe to call repeatedly. */
async function ensureUser(db: Db, ownerId: string): Promise<void> {
  await db.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();
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

  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    logDataEvent("error:INVALID_INPUT");
    return fail("INVALID_INPUT", { fields: fieldPaths(parsed.error) });
  }

  try {
    await ensureUser(context.db, decision.session.userId);
    return ok(await handler({ db: context.db, ownerId: decision.session.userId }, parsed.data));
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
