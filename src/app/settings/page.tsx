import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <section className="screen">
      <h1>Settings</h1>
      <p className="lede">Account and app settings will appear here.</p>
    </section>
  );
}
