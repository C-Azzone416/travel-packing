import { redirect } from "next/navigation";
import { ForgotForm } from "@/features/auth/ForgotForm";
import { getAuth } from "@/server/auth/auth-runtime";
import { authorizeOwner } from "@/server/auth/guard";
import { previewHost } from "@/server/auth/request-origin";
import { forgotAction, resendResetAction } from "./actions";

export const metadata = { title: "Reset your password" };
// Reads the session on every request.
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const auth = await getAuth();
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  return (
    <ForgotForm action={forgotAction} resendAction={resendResetAction} appHost={previewHost()} />
  );
}
