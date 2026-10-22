import { redirect } from "next/navigation";
import { FinishSetupView } from "@/features/auth/FinishSetupView";
import { getAuth } from "@/server/auth/auth-runtime";
import { flowLimits } from "@/server/auth/flow-limits";
import { authorizeOwner } from "@/server/auth/guard";
import { pendingEmail } from "@/server/auth/pending-email";
import { previewHost } from "@/server/auth/request-origin";
import { resendSetupAction } from "./actions";

export const metadata = { title: "Finish setting up" };
// Reads the session and the remembered address on every request.
export const dynamic = "force-dynamic";

export default async function FinishSetupPage() {
  const auth = await getAuth();
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  const email = await pendingEmail();
  return (
    <FinishSetupView
      email={email}
      initialCooldown={email ? flowLimits().cooldownRemaining("reset", email) : 0}
      resendAction={resendSetupAction}
      appHost={previewHost()}
    />
  );
}
