import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth-runtime";
import { authorizeOwner } from "@/server/auth/guard";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in · Travel Packing" };
// Reads the session on every request.
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const auth = await getAuth();
  // An allowlisted owner who is already signed in has nothing to do here.
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  return <SignInForm />;
}
