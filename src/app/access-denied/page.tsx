import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SIGN_IN_PATH } from "@/server/auth/proxy-handler";

export const metadata = { title: "Private" };

// Generic by design: no email, no hint about whether any data exists. The session was already ended
// on the server before the visitor got here.
export default function AccessDeniedPage() {
  return (
    <main className="auth-screen">
      <Card as="section" padded className="auth-card" aria-labelledby="denied-title">
        <p className="eyebrow">Carrywell</p>
        <h1 id="denied-title">This app is private</h1>
        <p>This account doesn’t have access.</p>
        <Link
          className={buttonClassName({ variant: "secondary", block: true })}
          href={SIGN_IN_PATH}
        >
          Back to sign in
        </Link>
      </Card>
    </main>
  );
}
