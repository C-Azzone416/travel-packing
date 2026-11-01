import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth-runtime";
import { deletionSession } from "@/server/auth/close-account";
import { accountClosureEnabled } from "@/server/auth/account-closure-rollout";
import { RetryCloseAccountForm } from "./RetryCloseAccountForm";

export const metadata = { title: "Finish account closure" };
export const dynamic = "force-dynamic";

export default async function CloseAccountPage() {
  if (!accountClosureEnabled()) redirect("/settings");
  const auth = await getAuth();
  if (!auth.available) redirect("/sign-in");
  const session = await deletionSession(auth);
  if (!session) redirect("/sign-in");
  let deletionPending = false;
  try {
    deletionPending = (await auth.setup.isAccountDeletionBlocked?.(session.userId)) ?? false;
  } catch {
    // Render the retry surface. Its action repeats the durable check and fails closed with a recoverable message.
    return <RetryCloseAccountForm />;
  }
  if (!deletionPending) redirect("/settings");
  return <RetryCloseAccountForm />;
}
