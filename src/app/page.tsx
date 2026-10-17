import type { Metadata } from "next";

// The root layout's title template skips the page in its own segment, so the
// home screen spells out its full title.
export const metadata: Metadata = { title: { absolute: "Trips · Carrywell" } };

export default function TripsPage() {
  return (
    <section className="screen">
      <h1>Trips</h1>
      <p className="lede">Your trips will appear here.</p>
    </section>
  );
}
