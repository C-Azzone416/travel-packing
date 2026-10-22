import { redirect } from "next/navigation";
import { VerifyForm } from "@/features/auth/VerifyForm";
import { getAuth } from "@/server/auth/auth-runtime";
import { flowLimits } from "@/server/auth/flow-limits";
import { authorizeOwner } from "@/server/auth/guard";
import { pendingEmail } from "@/server/auth/pending-email";
import { previewHost } from "@/server/auth/request-origin";
import { resendVerifyAction, verifyAction } from "./actions";

export const metadata = { title: "Check your email" };
// Reads the session and the remembered address on every request.
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const auth = await getAuth();
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  const email = await pendingEmail();
  return (
    <VerifyForm
      email={email}
      initialCooldown={email ? flowLimits().cooldownRemaining("verify", email) : 0}
      verifyAction={verifyAction}
      resendAction={resendVerifyAction}
      appHost={previewHost()}
    />
  );
}
