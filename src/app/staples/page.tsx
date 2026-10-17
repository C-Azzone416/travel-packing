import type { Metadata } from "next";

export const metadata: Metadata = { title: "Staples" };

export default function StaplesPage() {
  return (
    <section className="screen">
      <h1>Staples</h1>
      <p className="lede">Things you pack on every trip will appear here.</p>
    </section>
  );
}
