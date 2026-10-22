import type { Metadata } from "next";
import { InvalidLinkView } from "@/features/auth/InvalidLinkView";
import { readLinkParams } from "@/features/auth/link-params";
import { ResetForm } from "@/features/auth/ResetForm";
import { cleanToken } from "@/server/auth/account-flows";
import { resetAction } from "./actions";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The link carries a one-time token: never pass the address on to another site.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The emailed link lands here as ?token=... (or ?error=... when the provider already knows the link is bad). With no usable
 * token the form is never shown, so there is nothing to fill in and nothing to guess.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { token: rawToken, sealed } = readLinkParams(params);
  const token = cleanToken(rawToken);
  if (!token || params.error !== undefined) return <InvalidLinkView />;
  return (
    <ResetForm
      token={token}
      sealed={sealed}
      variant={params.setup === "1" ? "setup" : "reset"}
      action={resetAction}
    />
  );
}
