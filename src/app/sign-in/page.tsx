import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth-runtime";
import { authorizeOwner } from "@/server/auth/guard";
import { EMAIL_CONFIRMED, PASSWORD_UPDATED } from "@/features/auth/copy";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
// Reads the session on every request.
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  "password-updated": PASSWORD_UPDATED,
  verified: EMAIL_CONFIRMED,
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notice } = await searchParams;
  const auth = await getAuth();
  // An allowlisted owner who is already signed in has nothing to do here.
  if ((await authorizeOwner(auth.provider, auth.allowlist)).status === "ok") redirect("/");
  return <SignInForm notice={typeof notice === "string" ? (NOTICES[notice] ?? null) : null} />;
}
