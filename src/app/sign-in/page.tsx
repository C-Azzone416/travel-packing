import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth-runtime";
import { reconcilePendingAccountDeletions } from "@/server/auth/account-deletion";
import { accountClosureEnabled } from "@/server/auth/account-closure-rollout";
import { authorizeOwner } from "@/server/auth/guard";
import { getAppDb } from "@/server/db/app-db";
import {
  ACCOUNT_CLOSED,
  EMAIL_CONFIRMED,
  PASSWORD_SET,
  PASSWORD_UPDATED,
} from "@/features/auth/copy";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
// Reads the session on every request.
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  "account-closed": ACCOUNT_CLOSED,
  "password-updated": PASSWORD_UPDATED,
  "password-set": PASSWORD_SET,
  verified: EMAIL_CONFIRMED,
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notice } = await searchParams;
  const db = accountClosureEnabled() ? await getAppDb() : null;
  if (db) {
    try {
      await reconcilePendingAccountDeletions(db);
    } catch {
      // Reconciliation is fail-closed and best effort. A retained fence must not make the public sign-in page unavailable.
    }
  }
  const auth = await getAuth();
  // An allowlisted owner who is already signed in has nothing to do here.
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  return <SignInForm notice={typeof notice === "string" ? (NOTICES[notice] ?? null) : null} />;
}
