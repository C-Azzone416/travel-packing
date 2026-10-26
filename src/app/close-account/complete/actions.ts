"use server";

import { headers } from "next/headers";
import { getAuth } from "@/server/auth/auth-runtime";
import { consumeAccountClosureCompletion } from "@/server/auth/account-closure-completion";
import { hasSameRequestOrigin } from "@/server/auth/csrf";

/** Return true once, and only for a same-origin browser carrying a valid confirmed-deletion signal. */
export async function consumeAccountClosureSignalAction(): Promise<boolean> {
  if (!hasSameRequestOrigin(await headers())) return false;
  const auth = await getAuth();
  if (!auth.available) return false;
  return consumeAccountClosureCompletion(auth.completionSignals);
}
