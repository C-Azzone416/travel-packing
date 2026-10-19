import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/SignUpForm";
import { getAuth } from "@/server/auth/auth-runtime";
import { authorizeOwner } from "@/server/auth/guard";
import { signUpAction } from "./actions";

export const metadata = { title: "Create your account" };
// Reads the session on every request.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const auth = await getAuth();
  // An allowlisted owner who is already signed in has nothing to do here.
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  return <SignUpForm action={signUpAction} />;
}
