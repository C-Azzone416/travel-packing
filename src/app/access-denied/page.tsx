import Link from "next/link";
import { SIGN_IN_PATH } from "@/server/auth/proxy-handler";

export const metadata = { title: "Private · Travel Packing" };

// Generic by design: no email, no hint about whether any data exists. The session was already ended
// on the server before the visitor got here.
export default function AccessDeniedPage() {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="denied-title">
        <h1 id="denied-title">This app is private</h1>
        <p>This account doesn’t have access.</p>
        <Link href={SIGN_IN_PATH}>Back to sign in</Link>
      </section>
    </main>
  );
}
