import type { Metadata } from "next";

export const metadata: Metadata = { title: "Stamps" };

// A placeholder so the top menu's Stamps pill has somewhere to go (#383). The real page is #391. Like every app page it sits
// behind the sign-in proxy.
export default function StampsPage() {
  return (
    <div className="screen">
      <h1>Stamps</h1>
      <p className="lede">Every trip you take earns a sticker. They will collect here soon.</p>
    </div>
  );
}
